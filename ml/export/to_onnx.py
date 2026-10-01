import argparse
from pathlib import Path

import numpy as np
import onnx
import skl2onnx
import torch
from lightgbm import LGBMClassifier
from onnx import TensorProto, helper, numpy_helper
from onnxmltools.convert.lightgbm.operator_converters.LightGbm import convert_lightgbm
from skl2onnx.common.data_types import FloatTensorType
from skl2onnx.common.shape_calculator import calculate_linear_classifier_output_shapes
from sklearn.linear_model import LogisticRegression
from torch import nn

from export.specs import MODELS_DIR, OPSET, RUNS_DIR, SPECS, ModelSpec
from nets.standardize import Standardize

# ai.onnx.ml 3 ships with default-domain opset 17 in ONNX 1.12 (https://onnx.ai/onnx/repo-docs/Versioning.html).
ML_OPSET = 3

# onnxmltools.convert_lightgbm caps the default opset at 15, so its LightGBM operator converter is
# registered with skl2onnx, which accepts opset 17. Pattern from
# https://onnx.ai/sklearn-onnx/auto_tutorial/plot_gexternal_lightgbm.html
skl2onnx.update_registered_converter(
    LGBMClassifier,
    "LightGbmLGBMClassifier",
    calculate_linear_classifier_output_shapes,
    convert_lightgbm,
    options={"nocl": [True, False], "zipmap": [True, False, "columns"]},
)


def example_inputs(spec: ModelSpec) -> tuple[torch.Tensor, ...]:
    return tuple(torch.zeros(shape) for shape in spec.inputs.values())


def export_torch(spec: ModelSpec, model: nn.Module, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{spec.file_stem}.onnx"
    model.eval()
    batch_axis = {name: {0: "batch"} for name in (*spec.inputs, *spec.outputs)}
    # dynamo=False selects the TorchScript exporter: the dynamo exporter needs onnxscript, which ADR 0019
    # does not pin, and these small static graphs need nothing it adds.
    # https://pytorch.org/docs/stable/onnx_torchscript.html
    torch.onnx.export(
        model,
        example_inputs(spec),
        str(path),
        input_names=list(spec.inputs),
        output_names=list(spec.outputs),
        dynamic_axes=batch_axis,
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(str(path)), full_check=True)
    return path


def _load_trained(spec: ModelSpec, runs_dir: Path) -> nn.Module:
    weights = runs_dir / f"{spec.file_stem}.pt"
    if not weights.exists():
        raise FileNotFoundError(f"{weights} not found; train {spec.name} first")
    model = spec.build()
    model.load_state_dict(torch.load(weights, weights_only=True))
    return model.eval()


def _randomize_for_parity(model: nn.Module, seed: int) -> nn.Module:
    # Fresh BatchNorm stats (mean 0, var 1), unit feature scaling, and temperature 1 would make those
    # folded operations no-ops, so parity checks on untrained models randomize them too.
    generator = torch.Generator().manual_seed(seed)
    with torch.no_grad():
        for module in model.modules():
            if isinstance(module, nn.BatchNorm1d):
                module.running_mean.normal_(0.0, 0.5, generator=generator)
                module.running_var.uniform_(0.5, 2.0, generator=generator)
                module.weight.uniform_(0.5, 1.5, generator=generator)
                module.bias.normal_(0.0, 0.2, generator=generator)
            elif isinstance(module, Standardize):
                module.mean.normal_(0.0, 1.0, generator=generator)
                module.std.uniform_(0.5, 2.0, generator=generator)
        if hasattr(model, "temperature"):
            model.temperature.fill_(1.0 + float(torch.rand((), generator=generator)))
    return model.eval()


def source_model(spec: ModelSpec, runs_dir: Path, random_seed: int | None) -> nn.Module:
    if random_seed is None:
        return _load_trained(spec, runs_dir)
    torch.manual_seed(random_seed)
    return _randomize_for_parity(spec.build(), random_seed)


def _expose_probabilities(
    model_proto: onnx.ModelProto, output_name: str, positive_only: bool
) -> onnx.ModelProto:
    # Converters name their output "probabilities" with one column per class; the app reads the
    # manifest's output name, and binary models expose only P(positive) as [N, 1] like the neural ones.
    graph = model_proto.graph
    source = next(output for output in graph.output if output.name == "probabilities")
    classes = source.type.tensor_type.shape.dim[1].dim_value
    if positive_only:
        graph.initializer.extend(
            numpy_helper.from_array(np.array([value], dtype=np.int64), name=f"positive_{key}")
            for key, value in (("start", 1), ("end", 2), ("axis", 1))
        )
        graph.node.append(
            helper.make_node(
                "Slice",
                ["probabilities", "positive_start", "positive_end", "positive_axis"],
                [output_name],
            )
        )
        classes = 1
    else:
        graph.node.append(helper.make_node("Identity", ["probabilities"], [output_name]))
    del graph.output[:]
    graph.output.append(helper.make_tensor_value_info(output_name, TensorProto.FLOAT, [None, classes]))
    # skl2onnx 1.20 lists the default domain twice in opset_import; keep one entry per domain.
    versions: dict[str, int] = {}
    for opset in model_proto.opset_import:
        versions[opset.domain] = max(opset.version, versions.get(opset.domain, 0))
    del model_proto.opset_import[:]
    model_proto.opset_import.extend(
        helper.make_opsetid(domain, version) for domain, version in versions.items()
    )
    onnx.checker.check_model(model_proto, full_check=True)
    return model_proto


def export_classifier(
    classifier: LGBMClassifier | LogisticRegression, input_name: str, output_name: str, path: Path
) -> Path:
    model_proto = skl2onnx.convert_sklearn(
        classifier,
        initial_types=[(input_name, FloatTensorType([None, classifier.n_features_in_]))],
        target_opset={"": OPSET, "ai.onnx.ml": ML_OPSET},
        options={id(classifier): {"zipmap": False}},
    )
    binary = len(classifier.classes_) == 2
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_expose_probabilities(model_proto, output_name, binary).SerializeToString())
    return path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Export Lumen's neural models to ONNX (ML-3)")
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--all", action="store_true")
    which.add_argument("--name", choices=sorted(SPECS))
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--out-dir", type=Path, default=MODELS_DIR)
    parser.add_argument(
        "--random-init",
        type=int,
        metavar="SEED",
        help="export untrained, randomized models to check the export pipeline (never into models/)",
    )
    args = parser.parse_args(argv)
    if args.random_init is not None and args.out_dir.resolve() == MODELS_DIR.resolve():
        parser.error("--random-init needs --out-dir outside models/: untrained models must never ship")
    for name in sorted(SPECS) if args.all else [args.name]:
        spec = SPECS[name]
        path = export_torch(spec, source_model(spec, args.runs_dir, args.random_init), args.out_dir)
        print(f"{path}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()

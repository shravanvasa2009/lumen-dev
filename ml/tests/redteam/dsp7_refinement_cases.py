import json
import math
from pathlib import Path

from lumen_dsp.beats import detect_beats
from lumen_dsp.resample import ResampledSegment

# Fuzzed and clipped-peak DSP-7 inputs shared with packages/core/test/redteam/dsp7-refinement.test.ts
# (§10.2 parity, PR #147). Each case is rebuilt from its seed or parameters with Park–Miller uniforms and
# only + − × ÷ and comparisons, so both languages build the same doubles; the JSON holds Python's peak times
# and TypeScript must match them exactly.
# Regenerate with: uv run python -m tests.redteam.dsp7_refinement_cases (from ml/), then npx prettier --write
# on the JSON; the tests compare parsed values, so formatting does not matter to them.

REPO = Path(__file__).resolve().parents[3]
CASES_PATH = REPO / "packages" / "core" / "test" / "redteam" / "fixtures" / "dsp7-refinement-cases.json"

SECONDS = 12
MODEL_HZ = 64
SHAPE_HZ = 256
SEEDS = range(1, 81)
KINDS = ["clean", "noise", "bursts", "clipped", "premature"]


def park_miller(seed: int):
    state = seed

    def uniform() -> float:
        nonlocal state
        state = (state * 16807) % 2147483647
        return state / 2147483647

    return uniform


def _bump(x: float, rise_s: float, fall_s: float) -> float:
    # A squared raised parabola, 0 beyond its width: a pulse without exp, so both languages agree bit for bit.
    scaled = x / rise_s if x < 0 else x / fall_s
    q = 1 - scaled * scaled
    return q * q if q > 0 else 0.0


def build_case(seed: int) -> dict:
    # Spread the seeds: from a small seed the first Park–Miller draw is close to 0.
    uniform = park_miller(seed * 7919)
    kind = KINDS[seed % len(KINDS)]
    rr_s = 0.3 + 1.2 * uniform()
    rise_s = 0.03 + 0.07 * uniform()
    fall_s = rise_s * (1 + 4 * uniform())
    dicrotic = 0.9 * uniform()
    delay_s = 0.15 + 0.3 * uniform()
    dicrotic_s = 0.04 + 0.15 * uniform()
    premature_chance = 0.4 if kind == "premature" else 0.1
    first_model_index = math.floor(uniform() * 200)

    beats = []
    t_s = first_model_index / MODEL_HZ - 0.5 * uniform()
    while t_s < first_model_index / MODEL_HZ + SECONDS + 1:
        # Coupling 0.25–0.75 × RR: down to 75 ms after the previous beat at 200 bpm.
        interval_s = (
            rr_s * (0.25 + 0.5 * uniform())
            if uniform() < premature_chance
            else rr_s * (0.85 + 0.3 * uniform())
        )
        t_s += interval_s
        beats.append((t_s, 0.3 + 0.9 * uniform()))

    noise_level = 0.3 * uniform() if kind == "noise" else 0.0
    noise = [noise_level * (2 * uniform() - 1) for _ in range(first_model_index + SECONDS * MODEL_HZ + 1)]
    bursts = []
    if kind == "bursts":
        for _ in range(4):
            bursts.append(
                (
                    first_model_index / MODEL_HZ + SECONDS * uniform(),
                    0.05 + 0.4 * uniform(),
                    (uniform() - 0.5) * 8,
                )
            )
    clip_level = 0.4 + 0.5 * uniform() if kind == "clipped" else math.inf

    def value(t_s: float, noise_bin: int) -> float:
        total = 0.0
        for beat_s, amplitude in beats:
            x = t_s - beat_s
            total += amplitude * (
                _bump(x, rise_s, fall_s) + dicrotic * _bump(x - delay_s, dicrotic_s, dicrotic_s)
            )
        for start_s, length_s, height in bursts:
            if start_s <= t_s < start_s + length_s:
                total += height
        total += noise[noise_bin]
        return min(total, clip_level)

    model = [
        value((first_model_index + k) / MODEL_HZ, first_model_index + k) for k in range(SECONDS * MODEL_HZ)
    ]
    # The noise is held over each 1/64 s, so the 256 Hz band sees the same noise in runs of 4 equal samples.
    shape = [
        value((4 * first_model_index + j) / SHAPE_HZ, first_model_index + j // 4)
        for j in range(SECONDS * SHAPE_HZ)
    ]
    return {"seed": seed, "kind": kind, "firstModelIndex": first_model_index, "model": model, "shape": shape}


# A clipped peak: a parabola with its vertex at shape sample `centre`, cut flat at `clip`, so the top is a
# run of exactly equal samples. The model band has one bump whose Elgendi peak refines around sample 512.
PLATEAU_CENTRES = [512, 512.5, 513.25, 509.5, 516]
PLATEAU_CLIPS = [1.0, 0.9999, 0.999, 0.99, 0.95]


def build_plateau(centre: float, clip: float) -> dict:
    model = [_bump((k - 128) / MODEL_HZ, 0.1, 0.1) for k in range(4 * MODEL_HZ)]
    shape = []
    for j in range(4 * SHAPE_HZ):
        offset = (j - centre) / 64
        shape.append(min(clip, 1 - offset * offset))
    return {
        "kind": "plateau",
        "centre": centre,
        "clip": clip,
        "firstModelIndex": 0,
        "model": model,
        "shape": shape,
    }


def plateau_cases() -> list[dict]:
    return [build_plateau(centre, clip) for centre in PLATEAU_CENTRES for clip in PLATEAU_CLIPS]


def detect_case(case: dict) -> list[float]:
    model = ResampledSegment(first_index=case["firstModelIndex"], values=case["model"])
    shape = ResampledSegment(first_index=4 * case["firstModelIndex"], values=case["shape"])
    return [beat.peak_s for beat in detect_beats(model, shape)]


def cases() -> list[dict]:
    built = [build_case(seed) for seed in SEEDS] + plateau_cases()
    inputs = ("model", "shape")
    return [
        {**{key: case[key] for key in case if key not in inputs}, "peaksS": detect_case(case)}
        for case in built
    ]


def write_cases() -> None:
    CASES_PATH.write_text(json.dumps(cases(), indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write_cases()

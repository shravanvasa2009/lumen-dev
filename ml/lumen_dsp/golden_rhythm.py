import argparse
import json
import math
import sys
from pathlib import Path

from lumen_dsp.rhythm import RhythmWindow, has_enough_usable_intervals, rhythm_feature_vector, rhythm_windows

GOLDEN_PATH = Path(__file__).resolve().parents[2] / "packages" / "core" / "test" / "golden" / "rhythm.json"
PARK_MILLER_MODULUS = 2_147_483_647
# The regeneration check allows this much relative float drift: log, log2, and sqrt may differ by an ulp
# between operating systems; structure, integers, booleans, and nulls must match exactly.
CHECK_TOLERANCE = 1e-12


def park_miller_uniforms(count: int, seed: int) -> list[float]:
    state = seed
    uniforms = []
    for _ in range(count):
        state = (state * 16807) % PARK_MILLER_MODULUS
        uniforms.append(state / PARK_MILLER_MODULUS)
    return uniforms


def sinus_intervals(count: int, seed: int) -> list[float]:
    # 70 bpm with breathing-linked variation (one cycle per 4.5 beats) and 4 ms of jitter.
    noise = park_miller_uniforms(count, seed)
    return [0.85 + 0.03 * math.sin(2 * math.pi * k / 4.5) + 0.004 * (noise[k] - 0.5) for k in range(count)]


def interval_cases() -> list[dict]:
    regular = sinus_intervals(80, seed=11)
    af_like = [0.4 + 0.8 * u for u in park_miller_uniforms(80, seed=4242)]

    premature = sinus_intervals(80, seed=12)
    premature_beats = [False] * 81
    for k in (20, 50):
        # A premature beat ends interval k early; a compensatory pause follows. Beat k + 1 is atypical.
        premature[k], premature[k + 1] = 0.55, 1.15
        premature_beats[k + 1] = True

    gaps = [False] * 100
    gaps[40] = gaps[41] = True
    usable_39 = [False] * 41
    usable_39[3] = usable_39[7] = True
    usable_40 = [False] * 41
    usable_40[0] = True

    def case(name, intervals, spans=None, atypical=None):
        return {
            "name": name,
            "intervalsS": intervals,
            "spansArtifact": spans or [False] * len(intervals),
            "atypicalBeats": atypical or [False] * (len(intervals) + 1),
        }

    return [
        case("regular-sinus", regular),
        case("af-like", af_like),
        case("sinus-premature", premature, atypical=premature_beats),
        case("artifact-gaps", sinus_intervals(100, seed=13), spans=gaps),
        case("usable-39", sinus_intervals(41, seed=14), spans=usable_39),
        case("usable-40", sinus_intervals(41, seed=15), spans=usable_40),
        # Seed 1: no length-3 template matches, so SampEn is undefined and the feature vector fills it.
        case("sampen-undefined", [0.4 + 0.8 * u for u in park_miller_uniforms(32, seed=1)]),
        # Every x[i] + x[i + 1] is equal, so SD2 is exactly 0.
        case("alternating", [0.8 if k % 2 == 0 else 1.0 for k in range(32)]),
    ]


def window_json(window: RhythmWindow) -> dict:
    return {
        "startInterval": window.start_interval,
        "intervalsS": window.intervals_s,
        "normalizedRmssd": window.normalized_rmssd,
        "shannonEntropyBits": window.shannon_entropy_bits,
        "turningPointRatio": window.turning_point_ratio,
        "sd1S": window.sd1_s,
        "sd2S": window.sd2_s,
        "pnn50": window.pnn50,
        "sampleEntropy": window.sample_entropy,
        "atypicalFraction": window.atypical_fraction,
        "featureVector": rhythm_feature_vector(window),
    }


def golden_rhythm() -> dict:
    cases = []
    for case in interval_cases():
        windows = rhythm_windows(case["intervalsS"], case["spansArtifact"], case["atypicalBeats"])
        expected = {
            "hasEnoughUsableIntervals": has_enough_usable_intervals(case["spansArtifact"]),
            "windows": [window_json(window) for window in windows],
        }
        cases.append({**case, "expected": expected})
    return {"cases": cases}


def serialize(content: dict) -> str:
    # Compact, key order as built, shortest round-trip floats (Python repr), trailing newline.
    return json.dumps(content, separators=(",", ":"), allow_nan=False) + "\n"


def drift(expected, actual, path: str) -> list[str]:
    if isinstance(expected, dict) and isinstance(actual, dict):
        if list(expected) != list(actual):
            return [f"{path}: keys differ"]
        return [problem for key in expected for problem in drift(expected[key], actual[key], f"{path}.{key}")]
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return [f"{path}: length {len(actual)} != {len(expected)}"]
        return [
            problem
            for i, pair in enumerate(zip(expected, actual, strict=True))
            for problem in drift(*pair, f"{path}[{i}]")
        ]
    if isinstance(expected, float) and isinstance(actual, float):
        if abs(expected - actual) > CHECK_TOLERANCE * max(abs(expected), abs(actual)):
            return [f"{path}: {actual} != {expected}"]
        return []
    return (
        []
        if expected == actual and type(expected) is type(actual)
        else [f"{path}: {actual!r} != {expected!r}"]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write or check the DSP-15 golden vectors (§10.2).")
    parser.add_argument("--out", type=Path, default=GOLDEN_PATH)
    parser.add_argument("--check", action="store_true", help="compare with the file at --out; write nothing")
    args = parser.parse_args(argv)

    content = golden_rhythm()
    text = serialize(content)
    if not args.check:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {args.out} ({len(text.encode('utf-8'))} bytes)")
        return 0
    if not args.out.exists():
        print(f"{args.out}: missing", file=sys.stderr)
        return 1
    committed = args.out.read_text(encoding="utf-8")
    problems = [] if committed == text else drift(json.loads(committed), content, "")
    for problem in problems[:20]:
        print(problem, file=sys.stderr)
    if problems:
        print(f"{len(problems)} golden differences; regenerate and ask the owner to approve", file=sys.stderr)
        return 1
    print("rhythm golden vectors match the Python reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())

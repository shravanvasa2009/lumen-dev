import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

from lumen_dsp.beat_classes import RejectedSpan, classify_beats
from lumen_dsp.beats import detect_beats, elgendi_peaks
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import CausalFilter, butter_bandpass, butter_lowpass, filter_zero_phase
from lumen_dsp.resample import ResampledSegment, resample_cubic
from lumen_dsp.rhythm import RhythmWindow, has_enough_usable_intervals, rhythm_feature_vector, rhythm_windows
from lumen_dsp.shape import PulseShape, ensemble_beat
from lumen_dsp.signals import dc_level, finger_signals, sqi_model_input
from lumen_dsp.timebase import build_timebase

GOLDEN_DIR = Path(__file__).resolve().parents[2] / "packages" / "core" / "test" / "golden"
PARK_MILLER_MODULUS = 2_147_483_647
# An arbitrary device-clock start, far below 2^53 ns so JavaScript numbers hold every tNs exactly.
CLOCK_START_NS = 5_000_000_000_000
FPS = 60
SECONDS = 9
# The regeneration check allows float drift of CHECK_TOLERANCE × max(1, |value|): libm results (tan, exp,
# sin, log) can differ by an ulp between operating systems. Structure, integers, booleans, and nulls must
# match exactly.
CHECK_TOLERANCE = 1e-12


def park_miller_uniforms(count: int, seed: int) -> list[float]:
    state = seed
    uniforms = []
    for _ in range(count):
        state = (state * 16807) % PARK_MILLER_MODULUS
        uniforms.append(state / PARK_MILLER_MODULUS)
    return uniforms


def exact_150_ms_gap_start(offsets_ns: list[int], from_ns: int) -> int:
    # First frame at or after from_ns where (t + 150 ms) − t in seconds rounds to more than 0.15, so the
    # golden case catches an implementation that ignores the half-ns rule.
    for index, offset_ns in enumerate(offsets_ns):
        if offset_ns >= from_ns and (offset_ns + 150_000_000) / 1e9 - offset_ns / 1e9 > 0.15:
            return index
    raise ValueError("no frame triggers the 150 ms rounding case")


def frame_offsets_ns() -> list[int]:
    # 60 fps with ±1.5 ms Park–Miller jitter; two dropped frames near 1.7 s (bridged, flagged dropped);
    # a 200 ms gap at 3.0 s (splits); an exact 150 ms gap near 6 s (bridged).
    jitter = park_miller_uniforms(FPS * SECONDS, seed=12345)
    offsets_ns = [0] + [
        round((k / FPS + (2 * jitter[k] - 1) * 0.0015) * 1e9) for k in range(1, FPS * SECONDS)
    ]
    offsets_ns = [t for k, t in enumerate(offsets_ns) if k not in (100, 101) and not 3.0e9 < t < 3.2e9]
    gap_start = exact_150_ms_gap_start(offsets_ns, from_ns=6_000_000_000)
    resume = next(i for i, t in enumerate(offsets_ns) if t >= offsets_ns[gap_start] + 150_000_000)
    shift_ns = offsets_ns[gap_start] + 150_000_000 - offsets_ns[resume]
    return offsets_ns[: gap_start + 1] + [t + shift_ns for t in offsets_ns[resume:]]


def capture_columns() -> tuple[dict, dict]:
    offsets_ns = frame_offsets_ns()
    noise = park_miller_uniforms(3 * len(offsets_ns), seed=777)
    samples: dict[str, list] = {"tNs": [], "r": [], "g": [], "b": []}
    stats: dict[str, list] = {"tNs": [], "spatialStdR": [], "clipFrac": [], "exposureNs": []}
    for k, offset_ns in enumerate(offsets_ns):
        t_s = offset_ns / 1e9
        # A pulse with a dicrotic harmonic at 72 bpm, breathing at 15/min, and a little sensor noise.
        pulse = math.sin(2 * math.pi * 1.2 * t_s) + 0.35 * math.sin(2 * math.pi * 2.4 * t_s + 0.6)
        breathing = math.sin(2 * math.pi * 0.25 * t_s)
        samples["tNs"].append(CLOCK_START_NS + offset_ns)
        samples["r"].append(0.62 - 0.004 * pulse + 0.003 * breathing + 2e-4 * (noise[3 * k] - 0.5))
        samples["g"].append(0.11 - 0.001 * pulse + 1e-4 * (noise[3 * k + 1] - 0.5))
        samples["b"].append(0.04 + 1e-4 * (noise[3 * k + 2] - 0.5))
        stats["tNs"].append(CLOCK_START_NS + offset_ns)
        stats["spatialStdR"].append(0.02)
        stats["clipFrac"].append(0.0)
        stats["exposureNs"].append(8_000_000 if t_s < 4.5 else 6_000_000)
    return samples, stats


def floats(values: np.ndarray) -> list[float]:
    return [float(value) for value in values]


def golden_files() -> dict[str, dict]:
    samples, stats = capture_columns()
    timebase = build_timebase(samples, stats)
    primary, secondary = finger_signals(timebase)
    rates = [DSP_CONFIG["dsp2"]["modelRateHz"], DSP_CONFIG["dsp2"]["shapeRateHz"]]
    resampled = {rate: resample_cubic(timebase.t_s, primary, rate) for rate in rates}
    resampled_red = {rate: resample_cubic(timebase.t_s, timebase.r, rate) for rate in rates}

    def longest(segments):
        return max(segments, key=lambda segment: len(segment.values))

    dsp6 = DSP_CONFIG["dsp6"]
    designs = [
        ("hr", dsp6["hrOrder"], dsp6["hrBandHz"], rates[0]),
        ("morphology", dsp6["morphologyOrder"], dsp6["morphologyBandHz"], rates[0]),
        ("morphology", dsp6["morphologyOrder"], dsp6["morphologyBandHz"], rates[1]),
    ]
    filters = []
    for band, order, (low_hz, high_hz), rate in designs:
        sos = butter_bandpass(order, low_hz, high_hz, rate)
        source = longest(resampled[rate])
        filters.append(
            {
                "band": band,
                "order": order,
                "bandHz": [low_hz, high_hz],
                "rateHz": rate,
                "firstIndex": source.first_index,
                "sos": [floats(section) for section in sos],
                "zeroPhase": floats(filter_zero_phase(sos, source.values)),
                "causal": floats(CausalFilter(sos).filter(source.values)),
            }
        )

    dsp3 = DSP_CONFIG["dsp3"]
    dc = []
    for rate in rates:
        source = longest(resampled_red[rate])
        dc.append(
            {
                "rateHz": rate,
                "firstIndex": source.first_index,
                "sos": [
                    floats(section) for section in butter_lowpass(dsp3["dcOrder"], dsp3["dcCutoffHz"], rate)
                ],
                "dcLevel": floats(dc_level(source.values, rate)),
            }
        )

    return {
        "timebase.json": {
            "samples": samples,
            "stats": stats,
            "expected": {
                "startNs": timebase.start_ns,
                "tS": floats(timebase.t_s),
                "medianFrameIntervalS": timebase.median_frame_interval_s,
                "droppedGapStarts": [int(index) for index in timebase.dropped_gap_starts],
                "primary": floats(primary),
                "secondary": floats(secondary),
            },
        },
        "resample.json": {
            "rates": [
                {
                    "rateHz": rate,
                    "segments": [
                        {"firstIndex": segment.first_index, "values": floats(segment.values)}
                        for segment in resampled[rate]
                    ],
                }
                for rate in rates
            ]
        },
        "filters.json": {"bandPass": filters, "dcLevel": dc},
        "zscore.json": zscore_windows(longest(resampled[rates[0]])),
        "rhythm.json": rhythm_vectors(),
        "beats.json": beat_vectors(),
        "shape.json": shape_vectors(),
    }


def zscore_windows(segment: ResampledSegment) -> dict:
    # SQI-Net v1 inputs (DSP-3, ADR 0023: −R only) cut from the longest 64 Hz segment every 64 samples
    # (SQI runs every 1 s), plus a flat window, which has no input.
    rate = DSP_CONFIG["dsp2"]["modelRateHz"]
    samples = DSP_CONFIG["dsp3"]["modelWindowS"] * rate
    windows = []
    for start in range(0, len(segment.values) - samples + 1, rate):
        window_primary = floats(segment.values[start : start + samples])
        windows.append(
            {
                "firstIndex": segment.first_index + start,
                "primary": window_primary,
                "input": floats(sqi_model_input(window_primary)),
            }
        )
    windows.append({"firstIndex": None, "primary": [-0.62] * samples, "input": None})
    return {"windowSamples": samples, "windows": windows}


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


def rhythm_vectors() -> dict:
    cases = []
    for case in interval_cases():
        windows = rhythm_windows(case["intervalsS"], case["spansArtifact"], case["atypicalBeats"])
        expected = {
            "hasEnoughUsableIntervals": has_enough_usable_intervals(case["spansArtifact"]),
            "windows": [window_json(window) for window in windows],
        }
        cases.append({**case, "expected": expected})
    return {"cases": cases}


# A beat is (systolic peak time in s, amplitude); the waves below mirror packages/core/test/synthetic.ts.
Beat = tuple[float, float]


def ppg_wave(beats: list[Beat], dicrotic_ratio: float, seconds: float, rate_hz: float, first_index: int = 0):
    # Two-Gaussian pulse: systolic (σ 60 ms) plus a dicrotic wave 300 ms later (σ 80 ms) of dicrotic_ratio ×
    # its height, sampled at (first_index + k) / rate.
    def gaussian(t_s: float, centre_s: float, sigma_s: float) -> float:
        return math.exp(-0.5 * ((t_s - centre_s) / sigma_s) ** 2)

    wave = []
    for k in range(round(seconds * rate_hz)):
        t_s = (first_index + k) / rate_hz
        total = 0.0
        for peak_s, amplitude in beats:
            total += amplitude * (
                gaussian(t_s, peak_s, 0.06) + dicrotic_ratio * gaussian(t_s, peak_s + 0.3, 0.08)
            )
        wave.append(total)
    return wave


def regular_beats(first_s: float, last_s: float, bpm: float) -> list[Beat]:
    beats = []
    peak_s = first_s
    while peak_s < last_s:
        beats.append((peak_s, 1.0))
        peak_s += 60 / bpm
    return beats


def with_premature_beats(
    rr_s: float, seconds: float, premature_at: list[int], amplitude: float, coupling: float = 0.6
) -> list[Beat]:
    # Premature beat k comes coupling × RR after the previous beat; the next follows after (2 − coupling) ×
    # RR (a compensatory pause), so the rhythm stays in phase.
    beats = []
    peak_s = 1.0
    k = 0
    while peak_s < seconds - 1.5:
        if k in premature_at:
            peak_s += (coupling - 1) * rr_s
            beats.append((peak_s, amplitude))
            peak_s += (2 - coupling) * rr_s
        else:
            beats.append((peak_s, 1.0))
            peak_s += rr_s
        k += 1
    return beats


def morphology_segment(wave, rate_hz: float, first_index: int = 0) -> ResampledSegment:
    dsp6 = DSP_CONFIG["dsp6"]
    low_hz, high_hz = dsp6["morphologyBandHz"]
    sos = butter_bandpass(dsp6["morphologyOrder"], low_hz, high_hz, rate_hz)
    return ResampledSegment(
        first_index=first_index, values=filter_zero_phase(sos, np.asarray(wave, dtype=float))
    )


def beats_from_intervals(first_s: float, intervals_s: list[float]) -> list[Beat]:
    beats = [(first_s, 1.0)]
    for interval_s in intervals_s:
        beats.append((beats[-1][0] + interval_s, 1.0))
    return beats


def beat_case(name: str, wave: list[float], first_index_256: int, true_peaks_s, spans=()) -> dict:
    # The 256 Hz morphology band, rounded to 10 significant digits so the file stays small; both sides
    # compute from these exact values. The 64 Hz input is every fourth sample (first index ÷ 4).
    shape_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    model_hz = DSP_CONFIG["dsp2"]["modelRateHz"]
    filtered = morphology_segment(wave, shape_hz, first_index_256).values
    rounded = [float(f"{value:.10g}") for value in filtered]
    shape = ResampledSegment(first_index=first_index_256, values=np.asarray(rounded))
    model = ResampledSegment(first_index=first_index_256 // 4, values=np.asarray(rounded[::4]))
    rejected = [RejectedSpan(start_s, end_s, reason) for start_s, end_s, reason in spans]
    detected = detect_beats(model, shape)
    classified = classify_beats(detected, shape, rejected)
    return {
        "name": name,
        "firstIndex256": first_index_256,
        "morphology256": rounded,
        "spans": [{"startS": s.start_s, "endS": s.end_s, "reason": s.reason} for s in rejected],
        "truePeaksS": [float(peak_s) for peak_s in true_peaks_s],
        "expected": {
            "elgendiPeaks64": elgendi_peaks(model.values, model_hz),
            "detected": [
                {
                    "peakS": b.peak_s,
                    "onsetS": b.onset_s,
                    "maxUpslope": b.max_upslope,
                    "amplitude": b.amplitude,
                }
                for b in detected
            ],
            "classified": [{"beatClass": c.beat_class, "longPause": c.long_pause} for c in classified],
        },
    }


def beat_vectors() -> dict:
    # DSP-7/8/9 cases (§10.2): sinus, dicrotic double detections, premature beats, AF-like intervals,
    # bigeminy, rejected spans with long pauses and impossible intervals, and noise.
    hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    rr_s = 60 / 72

    def case(name, beats, seconds, dicrotic=0.3, first_index=0, spans=()):
        wave = ppg_wave(beats, dicrotic, seconds, hz, first_index)
        return beat_case(name, wave, first_index, [peak_s for peak_s, _ in beats], spans)

    af_like = beats_from_intervals(1.0, [0.4 + 0.8 * u for u in park_miller_uniforms(20, seed=4242)])
    pauses = beats_from_intervals(
        0.8, [rr_s] * 3 + [1.7 * rr_s] + [rr_s] * 3 + [2.6] + [rr_s] * 3 + [1.7 * rr_s] + [rr_s] * 2
    )
    noise = [(u - 0.5) * (1 + math.sin(n / 160)) for n, u in enumerate(park_miller_uniforms(8 * hz, seed=99))]
    return {
        "cases": [
            case("regular-sinus", regular_beats(3.0, 14.0, 72), 12, first_index=640),
            case("dicrotic-heavy", regular_beats(1.0, 11.0, 72), 12, dicrotic=0.9),
            case("premature", with_premature_beats(rr_s, 14, [4, 10], 0.5, 0.65), 14),
            case("af-like", [beat for beat in af_like if beat[0] < 11.0], 12),
            case("bigeminy", with_premature_beats(60 / 75, 12, [1, 3, 5, 7, 9, 11, 13], 0.5, 0.6), 12),
            case(
                "spans-and-pauses",
                pauses,
                16,
                spans=[(pauses[5][0] - 0.05, pauses[5][0] + 0.05, "motion"), (12.9, 13.1, "quality")],
            ),
            beat_case("noise", noise, 0, []),
        ]
    }


def shape_json(shape: PulseShape | None) -> dict | None:
    if shape is None:
        return None
    waves = shape.waves
    return {
        "beatsUsed": shape.beats_used,
        "beat": floats(shape.beat),
        "smoothed": floats(shape.smoothed),
        "secondDerivative": floats(shape.second_derivative),
        "waves": {"a": waves.a, "b": waves.b, "c": waves.c, "d": waves.d, "e": waves.e},
    }


def shape_vectors() -> dict:
    # DSP-14 inputs: a 256 Hz morphology-band PPG (rise σ 40 ms, fall σ 90 ms, dicrotic wave +300 ms) with
    # 24 beats at about 72 bpm (RR 0.83 s ± 50 ms, Park–Miller), onsets 80 ms before each peak.
    rate = DSP_CONFIG["dsp2"]["shapeRateHz"]
    jitter = park_miller_uniforms(23, seed=2024)
    peaks_s = [1.0]
    for u in jitter:
        peaks_s.append(peaks_s[-1] + 0.83 + 0.1 * (u - 0.5))
    t_s = np.arange(round((peaks_s[-1] + 1.0) * rate)) / rate
    wave = np.zeros_like(t_s)
    for peak_s in peaks_s:
        dt = t_s - peak_s
        wave += np.exp(-0.5 * (dt / np.where(dt < 0, 0.04, 0.09)) ** 2) + 0.3 * np.exp(
            -0.5 * ((dt - 0.3) / 0.06) ** 2
        )
    order, (low, high) = DSP_CONFIG["dsp6"]["morphologyOrder"], DSP_CONFIG["dsp6"]["morphologyBandHz"]
    morphology = filter_zero_phase(butter_bandpass(order, low, high, rate), wave)
    onsets = [(peak_s - 0.08) * rate for peak_s in peaks_s]

    one_atypical = [k != 12 for k in range(len(onsets))]
    too_few = [k % 6 != 0 for k in range(len(onsets))]
    # Dropping onset 8 leaves one double-length beat flagged normal, which the period gate removes.
    missed = [onset for k, onset in enumerate(onsets) if k != 8]
    cases = [
        ("jittered-72-bpm", onsets, one_atypical, 60),
        ("missed-onset", missed, [True] * len(missed), 60),
        ("too-few-normal-beats", onsets, too_few, 60),
        ("below-60-fps", onsets, one_atypical, 30),
    ]
    return {
        "signal": floats(morphology),
        "cases": [
            {
                "name": name,
                "onsets": case_onsets,
                "normal": normal,
                "captureFps": fps,
                "expected": shape_json(ensemble_beat(morphology, case_onsets, normal, fps)),
            }
            for name, case_onsets, normal, fps in cases
        ],
    }


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
        if abs(expected - actual) > CHECK_TOLERANCE * max(1.0, abs(expected), abs(actual)):
            return [f"{path}: {actual} != {expected}"]
        return []
    return (
        []
        if expected == actual and type(expected) is type(actual)
        else [f"{path}: {actual!r} != {expected!r}"]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write or check the DSP golden vectors (§10.2).")
    parser.add_argument("--out", type=Path, default=GOLDEN_DIR)
    parser.add_argument("--check", action="store_true", help="compare with the files in --out; write nothing")
    args = parser.parse_args(argv)

    problems = []
    for name, content in golden_files().items():
        target = args.out / name
        text = serialize(content)
        if not args.check:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target} ({len(text.encode('utf-8'))} bytes)")
            continue
        if not target.exists():
            problems.append(f"{target}: missing")
            continue
        committed = target.read_text(encoding="utf-8")
        if committed != text:
            problems += [f"{name}{problem}" for problem in drift(json.loads(committed), content, "")]
    for problem in problems[:20]:
        print(problem, file=sys.stderr)
    if problems:
        print(f"{len(problems)} golden differences; regenerate and ask the owner to approve", file=sys.stderr)
        return 1
    if args.check:
        print("golden vectors match the Python reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())

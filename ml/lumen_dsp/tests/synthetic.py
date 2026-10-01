import math
from collections.abc import Callable, Sequence

# Starts at an arbitrary device-clock value so tests prove times are taken relative to capture start.
CLOCK_START_NS = 5_000_000_000_000
PARK_MILLER_MODULUS = 2_147_483_647


def park_miller_uniforms(count: int, seed: int = 12345) -> list[float]:
    # Park–Miller minimal standard (16807, mod 2^31 − 1), as in packages/core/test/synthetic.ts.
    state = seed
    uniforms = []
    for _ in range(count):
        state = (state * 16807) % PARK_MILLER_MODULUS
        uniforms.append(state / PARK_MILLER_MODULUS)
    return uniforms


def regular_offsets(fps: float, seconds: float) -> list[float]:
    return [k / fps for k in range(round(fps * seconds))]


def jittered_offsets(fps: float, seconds: float, amplitude_s: float) -> list[float]:
    offsets = regular_offsets(fps, seconds)
    uniforms = park_miller_uniforms(len(offsets))
    return [
        0.0 if k == 0 else offset + (2 * uniforms[k - 1] - 1) * amplitude_s
        for k, offset in enumerate(offsets)
    ]


def capture_at(
    offsets_s: Sequence[float],
    channels: Callable[[float], tuple[float, float, float]],
    exposure_ns: int = 8_000_000,
) -> tuple[dict, dict]:
    samples: dict[str, list] = {"tNs": [], "r": [], "g": [], "b": []}
    stats: dict[str, list] = {"tNs": [], "spatialStdR": [], "clipFrac": [], "exposureNs": []}
    for offset_s in offsets_s:
        offset_ns = round(offset_s * 1e9)
        t_ns = CLOCK_START_NS + offset_ns
        # Evaluate at the whole-ns frame time the timebase will see, not the unrounded offset.
        red, green, blue = channels(offset_ns / 1e9)
        for key, value in (("tNs", t_ns), ("r", red), ("g", green), ("b", blue)):
            samples[key].append(value)
        for key, value in (
            ("tNs", t_ns),
            ("spatialStdR", 0.02),
            ("clipFrac", 0.0),
            ("exposureNs", exposure_ns),
        ):
            stats[key].append(value)
    return samples, stats


def sine(t_s: float, frequency_hz: float = 1.2) -> float:
    return math.sin(2 * math.pi * frequency_hz * t_s)

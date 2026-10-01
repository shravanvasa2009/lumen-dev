import Foundation

struct FormatCandidate {
  let width: Int
  let height: Int
  let maxFps: Double
}

// Spec §9.2 caps capture at 240 fps. With no requested rate, ADR 0029 uses the lens maximum up to 120 fps, so a
// 100 ms samples batch (12 frames) stays near the ~2 KB of spec §9.3.
let maxCaptureFps = 240.0
let defaultMaxCaptureFps = 120.0

func resolveTargetFps(requested: Double?, lensMaxFps: Double) -> Double {
  guard let requested, requested > 0 else { return min(lensMaxFps, defaultMaxCaptureFps) }
  return min(requested, lensMaxFps, maxCaptureFps)
}

// Spec §9.2: the lowest-resolution format that reaches the target rate. Ranges such as 59.94 fps count as 60, so
// a half-frame tolerance is allowed.
func chooseFormat(_ candidates: [FormatCandidate], targetFps: Double) -> Int? {
  candidates.indices
    .filter { candidates[$0].maxFps >= targetFps - 0.5 }
    .min { candidates[$0].width * candidates[$0].height < candidates[$1].width * candidates[$1].height }
}

// DSP-5 (spec §10) and Appendix A: lock when the red mean is 0.55–0.80 of full scale unless the caller asks
// otherwise.
let defaultExposureTarget = 0.55...0.80

// nil when the caller's window is not two increasing values within 0..1.
func exposureWindow(_ bounds: [Double]?) -> ClosedRange<Double>? {
  guard let bounds else { return defaultExposureTarget }
  guard bounds.count == 2, bounds[0] >= 0, bounds[0] < bounds[1], bounds[1] <= 1 else { return nil }
  return bounds[0]...bounds[1]
}

struct ExposureSetting {
  let durationS: Double
  let iso: Double
}

struct ExposureLimits {
  let minDurationS: Double
  // The smaller of the format's longest exposure and one frame interval, so exposure never lowers the frame rate.
  let maxDurationS: Double
  let minISO: Double
  let maxISO: Double
}

// The change in exposure that should bring the red mean to the middle of the DSP-5 window. Red arrives
// gamma-encoded in the 32BGRA output, so exposure scales roughly with the 2.2 power of the wanted change in red
// (sRGB transfer, IEC 61966-2-1). Clamped to 3 stops per step so one bad frame cannot swing the exposure far.
func exposureFactor(red: Double, target: ClosedRange<Double>) -> Double {
  let middle = (target.lowerBound + target.upperBound) / 2
  let wanted = pow(middle / max(red, 0.01), 2.2)
  return min(max(wanted, 0.125), 8)
}

// Scales total exposure (duration × ISO) by `factor` while keeping ISO as low as possible: the longest allowed
// duration first, then ISO for the rest, since higher ISO adds sensor noise to the pulse trace.
func planExposure(from current: ExposureSetting, factor: Double, limits: ExposureLimits) -> ExposureSetting {
  let total = current.durationS * current.iso * factor
  let duration = min(max(total / limits.minISO, limits.minDurationS), limits.maxDurationS)
  let iso = min(max(total / duration, limits.minISO), limits.maxISO)
  return ExposureSetting(durationS: duration, iso: iso)
}

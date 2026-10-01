package expo.modules.lumencapture

import kotlin.math.pow
import kotlin.math.roundToLong

// DSP-5 (spec §10) and Appendix A: lock when the red mean is 0.55–0.80 of full scale unless the caller asks
// otherwise.
val DEFAULT_EXPOSURE_TARGET = 0.55..0.80

// null when the caller's window is not two increasing values within 0..1.
fun exposureWindow(bounds: List<Double>?): ClosedFloatingPointRange<Double>? {
    if (bounds == null) return DEFAULT_EXPOSURE_TARGET
    if (bounds.size != 2 || bounds[0] < 0 || bounds[0] >= bounds[1] || bounds[1] > 1) return null
    return bounds[0]..bounds[1]
}

data class ExposureSetting(val durationNs: Double, val iso: Double)

// maxDurationNs is the smaller of the sensor's longest exposure and one frame interval, so exposure never
// lowers the frame rate.
data class ExposureLimits(val minDurationNs: Double, val maxDurationNs: Double, val minIso: Double, val maxIso: Double)

// sRGB-like transfer of the camera output (IEC 61966-2-1): exposure scales roughly with the 2.2 power of the
// wanted change in red. Clamped to 3 stops per step so one bad frame cannot swing the exposure far.
private const val GAMMA = 2.2
private const val MIN_FACTOR = 0.125
private const val MAX_FACTOR = 8.0
private const val MIN_RED = 0.01

// The change in exposure that should bring the red mean to the middle of the DSP-5 window (ADR 0029 addendum,
// same rule as the Swift module).
fun exposureFactor(red: Double, target: ClosedFloatingPointRange<Double>): Double {
    val middle = (target.start + target.endInclusive) / 2
    val wanted = (middle / red.coerceAtLeast(MIN_RED)).pow(GAMMA)
    return wanted.coerceIn(MIN_FACTOR, MAX_FACTOR)
}

// ADR 0029 addendum: waits inside lockExposure() (settings applied, fresh frames) are
// clamp(10 x median measured frame interval, 1 s, 3 s), so a slow camera gets more time but never unbounded.
private const val WAIT_FRAMES = 10
private const val MIN_WAIT_MS = 1000L
private const val MAX_WAIT_MS = 3000L

fun lockWaitMs(medianIntervalNs: Double): Long =
    (WAIT_FRAMES * medianIntervalNs / 1_000_000).roundToLong().coerceIn(MIN_WAIT_MS, MAX_WAIT_MS)

// Scales total exposure (duration x ISO) by `factor` while keeping ISO as low as possible: the longest allowed
// duration first, then ISO for the rest, since higher ISO adds sensor noise to the pulse trace.
fun planExposure(current: ExposureSetting, factor: Double, limits: ExposureLimits): ExposureSetting {
    val total = current.durationNs * current.iso * factor
    val duration = (total / limits.minIso).coerceIn(limits.minDurationNs, limits.maxDurationNs)
    val iso = (total / duration).coerceIn(limits.minIso, limits.maxIso)
    return ExposureSetting(duration, iso)
}

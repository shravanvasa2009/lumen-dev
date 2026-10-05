package expo.modules.lumencapture

import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.roundToInt
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

// A changed exposure reaches the output a few frames late; 0.2 s covers that at 30-240 fps (as in Swift).
const val EXPOSURE_LATENCY_MS = 200L

// Wait before the first red reading of lockExposure(): the rest of the settle (the lock wait, at least the
// spec's 1 s), counted from the first delivered frame, the closest Android point to Swift's startRunning(),
// and never less than the exposure latency. With no frame yet, the whole wait is still ahead.
fun settleWaitMs(lockWaitMs: Long, firstFrameNs: Long?, nowNs: Long): Long {
    val elapsedMs = if (firstFrameNs == null) 0L else (nowNs - firstFrameNs) / 1_000_000
    return maxOf(lockWaitMs - elapsedMs, EXPOSURE_LATENCY_MS)
}

// Scales total exposure (duration x ISO) by `factor` while keeping ISO as low as possible: the longest allowed
// duration first, then ISO for the rest, since higher ISO adds sensor noise to the pulse trace.
fun planExposure(current: ExposureSetting, factor: Double, limits: ExposureLimits): ExposureSetting {
    val total = current.durationNs * current.iso * factor
    val duration = (total / limits.minIso).coerceIn(limits.minDurationNs, limits.maxDurationNs)
    val iso = (total / duration).coerceIn(limits.minIso, limits.maxIso)
    return ExposureSetting(duration, iso)
}

// How lockExposure() holds exposure after the settle (spec §9.2 Locks, §4.2 step 3): a manual exposure where the
// lens takes one (MANUAL_SENSOR, needed for DSP-5 steering), else CONTROL_AE_LOCK where the lens reports
// CONTROL_AE_LOCK_AVAILABLE, else nothing. That key is guaranteed only with MANUAL_SENSOR or BURST_CAPTURE
// (CameraCharacteristics docs), so a LIMITED phone without either can land on NONE.
enum class ExposureHold { MANUAL, AE_LOCK, NONE }

fun exposureHold(manualExposure: Boolean, aeLockAvailable: Boolean): ExposureHold =
    when {
        manualExposure -> ExposureHold.MANUAL
        aeLockAvailable -> ExposureHold.AE_LOCK
        else -> ExposureHold.NONE
    }

// CONTROL_AE_COMPENSATION_RANGE in steps of CONTROL_AE_COMPENSATION_STEP EV. Lenses where the range is [0, 0] (no
// compensation) carry none.
data class AeCompensation(val minIndex: Int, val maxIndex: Int, val stepEv: Double)

// A red mean at or above this is clipped and says nothing about how far over the window it is (as in DSP-5's
// overexposure watch).
private const val CLIPPED_RED = 0.95

// The step taken on a clipped red: 2 EV, more than exposureFactor() gives at red 1.0 (about 1.25 EV), so a fully
// white frame leaves clipping in one or two steps instead of creeping down (Galaxy A17 log, 2026-10-05).
private const val CLIPPED_STEP_EV = -2.0

// DSP-5 for lenses that only take an AE lock (ADR 0098): the exposure change exposureFactor() asks for, in EV,
// a fixed step down when red is clipped.
fun compensationStepEv(red: Double, target: ClosedFloatingPointRange<Double>): Double =
    if (red >= CLIPPED_RED) CLIPPED_STEP_EV else log2(exposureFactor(red, target))

// The next CONTROL_AE_EXPOSURE_COMPENSATION index: at least one index in the wanted direction, within the lens range.
// Equal to `current` only for a zero step or at the range edge.
fun nextCompensationIndex(current: Int, stepEv: Double, compensation: AeCompensation): Int {
    if (stepEv == 0.0) return current
    val indices = stepEv / compensation.stepEv
    val step = if (indices < 0) minOf(indices.roundToInt(), -1) else maxOf(indices.roundToInt(), 1)
    return (current + step).coerceIn(compensation.minIndex, compensation.maxIndex)
}

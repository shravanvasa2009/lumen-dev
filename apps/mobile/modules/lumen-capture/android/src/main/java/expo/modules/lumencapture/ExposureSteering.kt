package expo.modules.lumencapture

import kotlin.math.max
import kotlin.math.roundToInt

// What the camera should do next. Every command carries the full exposure-compensation index so the
// session can rebuild its Camera2 request options from it alone.
sealed interface ExposureCommand {
    data class Steer(val compensationIndex: Int) : ExposureCommand

    data class Lock(val compensationIndex: Int) : ExposureCommand
}

// Default red-mean window when CaptureConfig.exposureTarget is omitted (Appendix A, DSP-5).
val DEFAULT_EXPOSURE_TARGET = 0.55..0.80

// AE needs a few frames to follow a new compensation value; 300 ms is about 9 frames at 30 fps.
// Checked on a phone by the DSP-5 device test.
private const val SETTLE_NS = 300_000_000L

// Lock anyway after 3 s so lockExposure() always resolves, even when the target cannot be reached.
private const val SEEK_TIMEOUT_NS = 3_000_000_000L

// DSP-5: if the red mean stays above 0.95 for 1 s after locking, lower exposure once and re-lock.
private const val OVEREXPOSED_RED = 0.95
private const val OVEREXPOSED_HOLD_NS = 1_000_000_000L
private const val RELOCK_DROP_EV = 1.0

// Each steering move is about 1/3 EV; the 0.55–0.80 window is log2(0.80 / 0.55) = 0.54 EV wide in linear
// light, so one move cannot jump across it.
private const val MOVE_EV = 1.0 / 3.0

// DSP-5 exposure control (ADR 0029): auto-exposure is steered with exposure compensation until the red
// mean is inside the target, then exposure, white balance and focus lock together.
class ExposureSteering(
    private val minIndex: Int,
    private val maxIndex: Int,
    stepEv: Double,
    private val target: ClosedFloatingPointRange<Double>,
) {
    private enum class Phase { AUTO, SEEKING, LOCKED, RELOCKING }

    private val moveSteps = max(1, (MOVE_EV / stepEv).roundToInt())
    private val relockSteps = max(1, (RELOCK_DROP_EV / stepEv).roundToInt())
    private var phase = Phase.AUTO
    private var index = 0
    private var seekStartNs = 0L
    private var lastChangeNs = 0L
    private var overexposedSinceNs: Long? = null
    private var relockUsed = false

    init {
        require(stepEv > 0) { "exposure compensation step must be positive" }
        require(minIndex <= 0 && maxIndex >= 0) { "compensation range must contain 0" }
    }

    val locked: Boolean
        get() = phase == Phase.LOCKED

    fun begin(nowNs: Long): ExposureCommand {
        phase = Phase.SEEKING
        seekStartNs = nowNs
        lastChangeNs = nowNs
        overexposedSinceNs = null
        relockUsed = false
        return ExposureCommand.Steer(index)
    }

    fun onFrame(red: Double, nowNs: Long): ExposureCommand? =
        when (phase) {
            Phase.AUTO -> null
            Phase.SEEKING -> seek(red, nowNs)
            Phase.LOCKED -> watchOverexposure(red, nowNs)
            Phase.RELOCKING -> if (nowNs - lastChangeNs >= SETTLE_NS) lock() else null
        }

    // Called from the status timer so a stalled camera still ends the search.
    fun onTick(nowNs: Long): ExposureCommand? =
        if (phase == Phase.SEEKING && nowNs - seekStartNs >= SEEK_TIMEOUT_NS) lock() else null

    private fun seek(red: Double, nowNs: Long): ExposureCommand? {
        if (nowNs - seekStartNs >= SEEK_TIMEOUT_NS) return lock()
        if (nowNs - lastChangeNs < SETTLE_NS) return null
        val next =
            when {
                red < target.start -> (index + moveSteps).coerceAtMost(maxIndex)
                red > target.endInclusive -> (index - moveSteps).coerceAtLeast(minIndex)
                else -> return lock()
            }
        if (next == index) return lock()
        index = next
        lastChangeNs = nowNs
        return ExposureCommand.Steer(index)
    }

    private fun watchOverexposure(red: Double, nowNs: Long): ExposureCommand? {
        if (red <= OVEREXPOSED_RED) {
            overexposedSinceNs = null
            return null
        }
        val since = overexposedSinceNs ?: nowNs.also { overexposedSinceNs = it }
        if (relockUsed || nowNs - since < OVEREXPOSED_HOLD_NS) return null
        relockUsed = true
        overexposedSinceNs = null
        index = (index - relockSteps).coerceAtLeast(minIndex)
        phase = Phase.RELOCKING
        lastChangeNs = nowNs
        return ExposureCommand.Steer(index)
    }

    private fun lock(): ExposureCommand {
        phase = Phase.LOCKED
        return ExposureCommand.Lock(index)
    }
}

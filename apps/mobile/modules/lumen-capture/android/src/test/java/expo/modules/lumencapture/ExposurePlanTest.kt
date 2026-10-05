package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.pow

// Mirrors the Swift CapturePlanTests exposure cases (PR #34), in ns instead of s.
class ExposurePlanTest {
    @Test
    fun exposureWindowDefaultsAndRejectsBadBounds() {
        assertEquals(0.55..0.80, exposureWindow(null))
        assertEquals(0.5..0.7, exposureWindow(listOf(0.5, 0.7)))
        assertNull(exposureWindow(listOf(0.7, 0.5)))
        assertNull(exposureWindow(listOf(0.5)))
        assertNull(exposureWindow(listOf(-0.1, 0.5)))
        assertNull(exposureWindow(listOf(0.5, 1.2)))
    }

    @Test
    fun exposureFactorAimsAtTheMiddleOfTheWindow() {
        val window = DEFAULT_EXPOSURE_TARGET
        assertEquals(1.0, exposureFactor(0.675, window), 1e-12)
        assertEquals((0.675 / 0.3).pow(2.2), exposureFactor(0.3, window), 1e-12)
        assertEquals(0.675.pow(2.2), exposureFactor(1.0, window), 1e-12)
        assertEquals(8.0, exposureFactor(0.01, window), 0.0)
        assertEquals(8.0, exposureFactor(0.0, window), 0.0)
    }

    @Test
    fun lockWaitIsTenFrameIntervalsClampedToOneToThreeSeconds() {
        assertEquals(1000L, lockWaitMs(1e9 / 30)) // 333 ms at 30 fps -> 1 s floor
        assertEquals(1500L, lockWaitMs(150e6)) // about 6.7 fps -> 1.5 s
        assertEquals(3000L, lockWaitMs(500e6)) // 2 fps -> 3 s cap
    }

    @Test
    fun settleWaitCountsFromTheFirstFrameAndNeverDropsBelowTheLatency() {
        val second = 1_000_000_000L
        // No frame yet: the whole lock wait is still ahead.
        assertEquals(1000L, settleWaitMs(lockWaitMs = 1000, firstFrameNs = null, nowNs = 5 * second))
        // First frame 300 ms ago: 700 ms of the 1 s settle remain.
        assertEquals(700L, settleWaitMs(lockWaitMs = 1000, firstFrameNs = 2 * second, nowNs = 2 * second + 300_000_000))
        // Settled long ago: still wait 0.2 s for fresh frames, as in Swift.
        assertEquals(200L, settleWaitMs(lockWaitMs = 1000, firstFrameNs = 0, nowNs = 10 * second))
        // A slow camera stretches the settle (2.5 s lock wait, 1 s elapsed).
        assertEquals(1500L, settleWaitMs(lockWaitMs = 2500, firstFrameNs = 0, nowNs = second))
    }

    @Test
    fun exposurePlanPrefersLongerDurationOverHigherIso() {
        val limits = ExposureLimits(minDurationNs = 1e4, maxDurationNs = 1e9 / 60, minIso = 50.0, maxIso = 3000.0)
        val current = ExposureSetting(durationNs = 4e6, iso = 100.0)

        val brighter = planExposure(current, 2.0, limits)
        assertEquals(1.6e7, brighter.durationNs, 1e-3)
        assertEquals(50.0, brighter.iso, 1e-9)

        val muchBrighter = planExposure(current, 10.0, limits)
        assertEquals(1e9 / 60, muchBrighter.durationNs, 1e-3)
        assertEquals(240.0, muchBrighter.iso, 1e-9)

        val darker = planExposure(current, 0.01, limits)
        assertEquals(8e4, darker.durationNs, 1e-6)
        assertEquals(50.0, darker.iso, 1e-9)

        val floor = planExposure(current, 1e-6, limits)
        assertEquals(1e4, floor.durationNs, 1e-9)
        assertEquals(50.0, floor.iso, 1e-9)
    }

    @Test
    fun exposureHoldPrefersManualThenAeLock() {
        assertEquals(ExposureHold.MANUAL, exposureHold(manualExposure = true, aeLockAvailable = true))
        assertEquals(ExposureHold.MANUAL, exposureHold(manualExposure = true, aeLockAvailable = false))
        assertEquals(ExposureHold.AE_LOCK, exposureHold(manualExposure = false, aeLockAvailable = true))
        assertEquals(ExposureHold.NONE, exposureHold(manualExposure = false, aeLockAvailable = false))
    }
}

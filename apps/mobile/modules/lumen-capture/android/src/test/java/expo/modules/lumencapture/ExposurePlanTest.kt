package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.log2
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

    // The Galaxy A17's rear lens: CONTROL_AE_COMPENSATION_RANGE [-40, 40] in 1/10 EV steps (dumpsys, 2026-10-05).
    private val a17 = AeCompensation(minIndex = -40, maxIndex = 40, stepEv = 0.1)

    @Test
    fun compensationStepIsSmallWhenRedClipsElseExposureFactorInEvCappedAtOne() {
        val window = DEFAULT_EXPOSURE_TARGET
        assertEquals(-0.5, compensationStepEv(1.0, window, clippedBefore = false), 0.0)
        assertEquals(-0.5, compensationStepEv(0.95, window, clippedBefore = false), 0.0)
        assertEquals(-1.0, compensationStepEv(1.0, window, clippedBefore = true), 0.0)
        assertEquals(2.2 * log2(0.675 / 0.9), compensationStepEv(0.9, window, clippedBefore = true), 1e-12)
        assertEquals(1.0, compensationStepEv(0.3, window, clippedBefore = false), 0.0) // 2.6 EV asked, capped
        assertEquals(0.0, compensationStepEv(0.675, window, clippedBefore = false), 1e-12)
    }

    @Test
    fun compensationIndexStepsInLensUnitsWithinTheRange() {
        assertEquals(-20, nextCompensationIndex(0, -2.0, a17))
        assertEquals(-40, nextCompensationIndex(-30, -2.0, a17))
        assertEquals(-40, nextCompensationIndex(-40, -2.0, a17)) // range edge: no further step
        assertEquals(13, nextCompensationIndex(0, 1.26, a17))
        // A step smaller than one index still moves one index, so steering never stalls inside the range.
        assertEquals(-1, nextCompensationIndex(0, -0.01, a17))
        assertEquals(1, nextCompensationIndex(0, 0.01, a17))
        assertEquals(5, nextCompensationIndex(5, 0.0, a17))
        // A coarser lens (1/3 EV steps, range +-6).
        assertEquals(-6, nextCompensationIndex(0, -2.0, AeCompensation(-6, 6, 1.0 / 3)))
    }

    // A sensor model fitted to the A17 log: red 0.615 at -1.0 EV and 0.288 at -3.0 EV, so red scales with
    // 2^(EV / 1.83); `atZero` is red at 0 EV before clipping at 1.
    private fun sensor(atZero: Double, gamma: Double = 1.83): (Int) -> Double =
        { index -> minOf(1.0, atZero * 2.0.pow(index * a17.stepEv / gamma)) }

    private fun steer(startIndex: Int, model: (Int) -> Double) =
        steerCompensation(CompensationStep(startIndex, model(startIndex)), DEFAULT_EXPOSURE_TARGET, a17, 4, model)

    @Test
    fun steeringEndsInsideTheWindowWithoutDippingUnderIt() {
        // From the A17's pre-lock state (red about 0.9 at 0 EV), a clipped finger, and a very bright one.
        for (atZero in listOf(0.9, 1.1, 2.0, 3.0)) {
            val path = steer(0, sensor(atZero))
            assertTrue("$atZero: $path", path.last().red in DEFAULT_EXPOSURE_TARGET)
            assertTrue("$atZero: $path", path.all { it.red >= DEFAULT_EXPOSURE_TARGET.start })
            assertTrue("$atZero: $path", path.size <= 5)
        }
    }

    @Test
    fun reliefWithRedBackInsideTakesNoStep() {
        // The A17 relief of 2026-10-05: locked at -1.0 EV with red 0.615, a press clipped red for a moment. Measured
        // afresh after the unlock, red is inside again, so the compensation stays.
        val path = steer(-10, sensor(0.615 * 2.0.pow(1.0 / 1.83)))
        assertEquals(listOf(CompensationStep(-10, path.single().red)), path)
    }

    @Test
    fun steeringStepsBackUpFromADarkRedAndStopsAtTheRangeEdge() {
        val dark = steer(-30, sensor(0.615 * 2.0.pow(1.0 / 1.83)))
        assertTrue("$dark", dark.last().red in DEFAULT_EXPOSURE_TARGET)
        assertTrue("$dark", dark.zipWithNext().all { (a, b) -> b.index > a.index })
        // Too bright even at -4 EV: stops at the edge instead of looping.
        val edge = steer(-40, sensor(100.0))
        assertEquals(1, edge.size)
    }
}

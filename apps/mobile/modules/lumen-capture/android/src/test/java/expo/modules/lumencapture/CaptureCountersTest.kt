package expo.modules.lumencapture

import android.os.PowerManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val INTERVAL_NS = 16_666_667L // 60 fps
private const val SECOND_NS = 1_000_000_000L
private val COVERED = FrameNumbers(r = 0.6, g = 0.1, b = 0.1, spatialStdR = 0.02, clipFrac = 0.0)

private fun CaptureCounters.frameAt(tNs: Long, numbers: FrameNumbers = COVERED, workNs: Long = 0) =
    addFrame(CapturedFrame(tNs, numbers, exposureNs = 8_000_000), arrivalNs = tNs, workNs = workNs)

class CaptureCountersTest {
    @Test
    fun steadyFramesDropNothing() {
        val counters = CaptureCounters(INTERVAL_NS)
        for (i in 0 until 120) counters.frameAt(i * INTERVAL_NS)
        assertEquals(120L, counters.frames)
        assertEquals(0L, counters.dropped)
    }

    @Test
    fun gapsCountRoundedMissingFramesAbove1point5Intervals() {
        val counters = CaptureCounters(INTERVAL_NS)
        var t = 0L
        counters.frameAt(t)
        t += (1.4 * INTERVAL_NS).toLong() // jitter, not a drop
        counters.frameAt(t)
        t += 2 * INTERVAL_NS // one frame missing
        counters.frameAt(t)
        t += (3.2 * INTERVAL_NS).toLong() // round(3.2) - 1 = 2 missing
        counters.frameAt(t)
        assertEquals(3L, counters.dropped)
        assertEquals(3.0 / (4 + 3), counters.status(t).droppedFrac, 1e-12)
    }

    @Test
    fun fpsCountsArrivalsInTheLastSecondAndFallsToZero() {
        val counters = CaptureCounters(INTERVAL_NS)
        for (i in 0 until 90) counters.frameAt(i * INTERVAL_NS)
        val last = 89 * INTERVAL_NS
        assertEquals(60.0, counters.status(last).fps, 0.0)
        assertEquals(0.0, counters.status(last + SECOND_NS).fps, 0.0)
    }

    @Test
    fun batchesHandOverEachFrameOnce() {
        val counters = CaptureCounters(INTERVAL_NS)
        counters.frameAt(0)
        counters.frameAt(INTERVAL_NS)
        assertEquals(listOf(0L, INTERVAL_NS), counters.drainBatch().map { it.tNs })
        assertTrue(counters.drainBatch().isEmpty())
    }

    @Test
    fun medianIntervalReplacesTheNominalOneAfterFiveIntervals() {
        // Nominal 60 fps but the camera delivers 30 fps: the first 5 intervals count one drop each against the
        // nominal interval, then the 1 s median (33 ms) takes over and steady frames drop nothing.
        val counters = CaptureCounters(INTERVAL_NS)
        val thirtyFps = 2 * INTERVAL_NS
        for (i in 0 until 60) counters.frameAt(i * thirtyFps)
        assertEquals(5L, counters.dropped)
        // A gap of 3 intervals at the median hides 2 frames.
        counters.frameAt(59 * thirtyFps + 3 * thirtyFps)
        assertEquals(7L, counters.dropped)
    }

    @Test
    fun medianOfIntervals() {
        assertNull(medianIntervalNs(listOf(10L, 10, 10, 10)))
        assertEquals(10.0, medianIntervalNs(listOf(10L, 10, 10, 10, 10))!!, 0.0)
        assertEquals(15.0, medianIntervalNs(listOf(10L, 10, 10, 20, 20, 20))!!, 0.0)
    }

    @Test
    fun medianCountsIntervalsThatEndedInTheLastSecondLikeSwift() {
        // 6 fps against a 30 fps nominal interval: the 5 intervals ending in the last second already give a
        // median at the 6th frame, so only frames 1..5 count drops (4 each). Counting intervals between frames
        // inside the window would see only 4 and keep using the nominal interval.
        val counters = CaptureCounters(33_333_333L)
        for (i in 0 until 30) counters.frameAt(i * 166_666_667L)
        assertEquals(20L, counters.dropped)
    }

    @Test
    fun contactHintUsesTheNewestFrameSinceTheLastStatus() {
        val counters = CaptureCounters(INTERVAL_NS)
        assertFalse(counters.status(0).fingerCovered)
        counters.frameAt(0, numbers = COVERED.copy(r = 0.1))
        counters.frameAt(INTERVAL_NS)
        assertTrue(counters.status(INTERVAL_NS).fingerCovered)
        assertFalse(counters.status(INTERVAL_NS).fingerCovered)
        counters.frameAt(2 * INTERVAL_NS)
        counters.frameAt(3 * INTERVAL_NS, numbers = COVERED.copy(r = 0.1))
        assertFalse(counters.status(3 * INTERVAL_NS).fingerCovered)
    }

    @Test
    fun overexposureWatchFiresOnceAfterHalfASecondWhenArmed() {
        val counters = CaptureCounters(INTERVAL_NS)
        val bright = COVERED.copy(r = 0.97)
        assertFalse(counters.frameAt(0, numbers = bright))
        assertFalse(counters.frameAt(SECOND_NS, numbers = bright)) // not armed
        counters.armOverexposureWatch()
        assertFalse(counters.frameAt(2 * SECOND_NS, numbers = bright))
        assertFalse(counters.frameAt(2 * SECOND_NS + 300_000_000, numbers = COVERED.copy(r = 0.95)))
        assertFalse(counters.frameAt(2 * SECOND_NS + 400_000_000, numbers = bright))
        assertTrue(counters.frameAt(2 * SECOND_NS + 900_000_000, numbers = bright))
        assertFalse(counters.frameAt(4 * SECOND_NS, numbers = bright)) // once until re-armed
        assertEquals(0.97, counters.lastRed!!, 0.0)
    }

    @Test
    fun frameWorkReportsMeanAndMaxThenResets() {
        val counters = CaptureCounters(INTERVAL_NS)
        counters.frameAt(0, workNs = 1_000_000)
        counters.frameAt(INTERVAL_NS, workNs = 3_000_000)
        assertEquals(FrameWorkMs(2.0, 3.0), counters.takeFrameWork())
        assertEquals(FrameWorkMs(0.0, 0.0), counters.takeFrameWork())
    }
}

class ContactHintTest {
    @Test
    fun dsp4InitialValuesAreInclusiveLimits() {
        assertTrue(fingerCovered(FrameNumbers(r = 0.4, g = 0.1, b = 0.1, spatialStdR = 0.10, clipFrac = 0.05)))
        assertTrue(fingerCovered(FrameNumbers(r = 0.30, g = 0.05, b = 0.05, spatialStdR = 0.0, clipFrac = 0.0)))
    }

    @Test
    fun eachDsp4LimitAloneRejects() {
        assertFalse(fingerCovered(COVERED.copy(g = 0.2, b = 0.11))) // R/(G+B) < 2
        assertFalse(fingerCovered(FrameNumbers(r = 0.29, g = 0.0, b = 0.0, spatialStdR = 0.0, clipFrac = 0.0)))
        assertFalse(fingerCovered(COVERED.copy(spatialStdR = 0.11)))
        assertFalse(fingerCovered(COVERED.copy(clipFrac = 0.06)))
    }
}

class ThermalNameTest {
    @Test
    fun androidLevelsMapToTheFourContractStates() {
        assertEquals("nominal", thermalName(PowerManager.THERMAL_STATUS_NONE))
        assertEquals("fair", thermalName(PowerManager.THERMAL_STATUS_LIGHT))
        assertEquals("fair", thermalName(PowerManager.THERMAL_STATUS_MODERATE))
        assertEquals("serious", thermalName(PowerManager.THERMAL_STATUS_SEVERE))
        assertEquals("critical", thermalName(PowerManager.THERMAL_STATUS_CRITICAL))
        assertEquals("critical", thermalName(PowerManager.THERMAL_STATUS_EMERGENCY))
        assertEquals("critical", thermalName(PowerManager.THERMAL_STATUS_SHUTDOWN))
    }
}

class MotionWindowTest {
    @Test
    fun rmsIsInGOverTheLastSecond() {
        val motion = MotionWindow()
        assertEquals(0.0, motion.rmsG(0), 0.0)
        for (i in 0 until 50) motion.add(i * 20_000_000L, 9.80665f, 0f, 0f)
        assertEquals(1.0, motion.rmsG(49 * 20_000_000L), 1e-6)
        // 3-4-0 m/s² is 5 m/s² in magnitude.
        val later = 2 * SECOND_NS
        motion.add(later, 3f, 4f, 0f)
        assertEquals(5 / 9.80665, motion.rmsG(later), 1e-6)
    }
}

class ExposureLogTest {
    @Test
    fun matchesByTimestampThenFallsBackToTheNewestEarlierResult() {
        val log = ExposureLog(capacity = 4)
        assertEquals(0L, log.exposureAt(100))
        log.record(100, 1_000)
        log.record(200, 2_000)
        assertEquals(1_000L, log.exposureAt(100))
        assertEquals(2_000L, log.exposureAt(250))
        assertEquals(2_000L, log.exposureAt(50)) // nothing earlier: the newest result
    }

    @Test
    fun oldResultsAreOverwritten() {
        val log = ExposureLog(capacity = 2)
        log.record(100, 1_000)
        log.record(200, 2_000)
        log.record(300, 3_000)
        assertEquals(3_000L, log.exposureAt(100)) // 100 is gone, nothing earlier remains
        assertEquals(2_000L, log.exposureAt(250))
    }
}

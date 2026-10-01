package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val MS = 1_000_000L

// A typical phone: -12..12 in steps of 1/6 EV, so one move is 2 steps and the re-lock drop is 6.
private fun steering() = ExposureSteering(minIndex = -12, maxIndex = 12, stepEv = 1.0 / 6.0, target = DEFAULT_EXPOSURE_TARGET)

class ExposureSteeringTest {
    @Test
    fun nothingHappensBeforeLockExposure() {
        assertNull(steering().onFrame(0.1, 0))
    }

    @Test
    fun locksAtOnceWhenRedIsInsideTheTargetAfterSettling() {
        val s = steering()
        assertEquals(ExposureCommand.Steer(0), s.begin(0))
        assertNull(s.onFrame(0.7, 100 * MS)) // still settling
        assertEquals(ExposureCommand.Lock(0), s.onFrame(0.7, 300 * MS))
        assertTrue(s.locked)
    }

    @Test
    fun darkRedStepsExposureUpUntilInside() {
        val s = steering()
        s.begin(0)
        assertEquals(ExposureCommand.Steer(2), s.onFrame(0.3, 300 * MS))
        assertNull(s.onFrame(0.4, 400 * MS))
        assertEquals(ExposureCommand.Steer(4), s.onFrame(0.45, 600 * MS))
        assertEquals(ExposureCommand.Lock(4), s.onFrame(0.6, 900 * MS))
    }

    @Test
    fun brightRedStepsExposureDown() {
        val s = steering()
        s.begin(0)
        assertEquals(ExposureCommand.Steer(-2), s.onFrame(0.9, 300 * MS))
    }

    @Test
    fun locksAtTheCompensationLimit() {
        val s = ExposureSteering(minIndex = -2, maxIndex = 2, stepEv = 1.0 / 6.0, target = DEFAULT_EXPOSURE_TARGET)
        s.begin(0)
        assertEquals(ExposureCommand.Steer(2), s.onFrame(0.1, 300 * MS))
        assertEquals(ExposureCommand.Lock(2), s.onFrame(0.1, 600 * MS))
    }

    @Test
    fun locksWithoutCompensationSupport() {
        val s = ExposureSteering(minIndex = 0, maxIndex = 0, stepEv = 1.0, target = DEFAULT_EXPOSURE_TARGET)
        s.begin(0)
        assertEquals(ExposureCommand.Lock(0), s.onFrame(0.1, 300 * MS))
    }

    @Test
    fun timeoutLocksEvenWithoutFrames() {
        val s = steering()
        s.begin(0)
        assertNull(s.onTick(2_999 * MS))
        assertEquals(ExposureCommand.Lock(0), s.onTick(3_000 * MS))
    }

    @Test
    fun sustainedOverexposureLowersExposureOnceAndRelocks() {
        val s = steering()
        s.begin(0)
        s.onFrame(0.7, 300 * MS)
        assertNull(s.onFrame(0.97, 1_000 * MS))
        assertNull(s.onFrame(0.97, 1_500 * MS))
        assertEquals(ExposureCommand.Steer(-6), s.onFrame(0.97, 2_000 * MS))
        assertNull(s.onFrame(0.97, 2_100 * MS))
        assertEquals(ExposureCommand.Lock(-6), s.onFrame(0.97, 2_300 * MS))
        assertNull(s.onFrame(0.97, 3_400 * MS))
        assertNull(s.onFrame(0.97, 5_000 * MS)) // only once per lockExposure()
    }

    @Test
    fun briefOverexposureIsIgnored() {
        val s = steering()
        s.begin(0)
        s.onFrame(0.7, 300 * MS)
        assertNull(s.onFrame(0.97, 1_000 * MS))
        assertNull(s.onFrame(0.9, 1_500 * MS))
        assertNull(s.onFrame(0.97, 1_900 * MS))
        assertNull(s.onFrame(0.97, 2_100 * MS))
    }
}

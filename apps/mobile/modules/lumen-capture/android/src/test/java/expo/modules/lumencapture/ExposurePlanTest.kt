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
}

package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LensKindTest {
    // A 1/1.3" class main sensor, 9.8 x 7.4 mm (diagonal 12.28 mm): equivalent = f x 3.52.
    @Test
    fun equivalentFocalLengthDecidesTheKind() {
        assertEquals("ultrawide", lensKind(4.0f, 9.8f, 7.4f)) // 14 mm
        assertEquals("wide", lensKind(6.9f, 9.8f, 7.4f)) // 24 mm
        assertEquals("tele", lensKind(14f, 9.8f, 7.4f)) // 49 mm
    }

    @Test
    fun missingCharacteristicsGiveUnknown() {
        assertEquals("unknown", lensKind(null, 9.8f, 7.4f))
        assertEquals("unknown", lensKind(6.9f, null, 7.4f))
        assertEquals("unknown", lensKind(0f, 9.8f, 7.4f))
    }
}

class PickFpsRangeTest {
    private val typical = listOf(FpsRange(15, 30), FpsRange(30, 30), FpsRange(15, 60), FpsRange(60, 60))

    @Test
    fun highestRateWithTheHighestFloor() {
        assertEquals(FpsRange(60, 60), pickFpsRange(typical, 240))
    }

    @Test
    fun requestedRateCapsTheChoice() {
        assertEquals(FpsRange(30, 30), pickFpsRange(typical, 30))
    }

    @Test
    fun belowEveryRangeTakesTheSlowest() {
        assertEquals(FpsRange(30, 30), pickFpsRange(typical, 20))
    }

    @Test
    fun noRangesGiveNull() {
        assertNull(pickFpsRange(emptyList(), 60))
    }
}

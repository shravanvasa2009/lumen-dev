package expo.modules.lumencapture

import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_AUTO
import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE
import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_OFF
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

// Spec §5.1 counts a fixed-focus lens like a focus lock (ADR 0058 item 5).
class FocusTest {
    private val autofocus = intArrayOf(CONTROL_AF_MODE_AUTO, CONTROL_AF_MODE_CONTINUOUS_PICTURE)

    @Test
    fun zeroMinimumFocusDistanceIsFixedFocus() {
        assertTrue(isFixedFocus(intArrayOf(CONTROL_AF_MODE_OFF), 0f))
        assertFalse(isFixedFocus(intArrayOf(CONTROL_AF_MODE_OFF) + autofocus, 10f))
    }

    @Test
    fun onlyAfModeOffIsFixedFocus() {
        assertTrue(isFixedFocus(intArrayOf(CONTROL_AF_MODE_OFF), null))
    }

    @Test
    fun missingMinimumFocusDistanceIsNotFixedFocus() {
        assertFalse(isFixedFocus(autofocus, null))
        assertFalse(isFixedFocus(IntArray(0), null))
    }

    @Test
    fun focusHoldsWhenFixedOrManual() {
        assertTrue(focusHolds(IntArray(0), fixedFocus = true))
        assertTrue(focusHolds(intArrayOf(CONTROL_AF_MODE_OFF) + autofocus, fixedFocus = false))
        assertFalse(focusHolds(autofocus, fixedFocus = false))
    }
}

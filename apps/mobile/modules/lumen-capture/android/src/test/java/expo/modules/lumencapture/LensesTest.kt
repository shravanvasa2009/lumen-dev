package expo.modules.lumencapture

import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_AUTO
import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE
import android.hardware.camera2.CameraMetadata.CONTROL_AF_MODE_OFF
import android.hardware.camera2.CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_FULL
import android.hardware.camera2.CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY
import android.hardware.camera2.CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED
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

class HardwareLevelNameTest {
    @Test
    fun namesEveryLevelAndAMissingKey() {
        assertEquals("LEGACY", hardwareLevelName(INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY))
        assertEquals("LIMITED", hardwareLevelName(INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED))
        assertEquals("FULL", hardwareLevelName(INFO_SUPPORTED_HARDWARE_LEVEL_FULL))
        assertEquals("unknown", hardwareLevelName(null))
        assertEquals("level 9", hardwareLevelName(9))
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

    private val manual = intArrayOf(CONTROL_AF_MODE_OFF) + autofocus

    @Test
    fun fixedFocusAlwaysHolds() {
        assertTrue(focusHolds(IntArray(0), fixedFocus = true, minimumFocusDistance = null, hardwareLevel = null))
        assertTrue(focusHolds(IntArray(0), true, 0f, INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY))
    }

    @Test
    fun manualFocusHoldsWithAKnownRangeAboveLegacy() {
        assertTrue(focusHolds(manual, false, 10f, INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED))
        assertTrue(focusHolds(manual, false, 10f, INFO_SUPPORTED_HARDWARE_LEVEL_FULL))
    }

    // The audit case: a budget LEGACY camera lists AF mode OFF, but nothing shows a set distance is honored.
    @Test
    fun legacyUnknownRangeOrNoAfOffDoesNotHold() {
        assertFalse(focusHolds(manual, false, 10f, INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY))
        assertFalse(focusHolds(manual, false, null, INFO_SUPPORTED_HARDWARE_LEVEL_FULL))
        assertFalse(focusHolds(manual, false, 10f, null))
        assertFalse(focusHolds(autofocus, false, 10f, INFO_SUPPORTED_HARDWARE_LEVEL_FULL))
    }
}

class LensExposureHoldTest {
    private fun lens(manual: ManualExposureRange?, aeLock: Boolean) =
        RearLens(
            id = "0",
            cameraId = "0",
            physicalId = null,
            kind = "wide",
            fpsRanges = listOf(FpsRange(30, 30)),
            torchUsable = true,
            torchLevels = false,
            exposureLock = aeLock,
            whiteBalanceLock = true,
            focusLock = true,
            fixedFocus = false,
            minimumFocusDistance = 10f,
            manualExposure = manual,
            aeCompensation = null,
            realtimeTimestamps = true,
            hardwareLevel = INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED,
        )

    // A LIMITED camera without MANUAL_SENSOR, like the Galaxy A17's: only CONTROL_AE_LOCK can hold exposure.
    @Test
    fun lensHoldFollowsItsCharacteristics() {
        val manual = ManualExposureRange(10_000L, 100_000_000L, 50, 3200)
        assertEquals(ExposureHold.MANUAL, lens(manual, aeLock = true).exposureHold)
        assertEquals(ExposureHold.AE_LOCK, lens(null, aeLock = true).exposureHold)
        assertEquals(ExposureHold.NONE, lens(null, aeLock = false).exposureHold)
    }
}

class AeCompensationTest {
    @Test
    fun compensationNeedsANonEmptyRangeAndAStep() {
        assertEquals(AeCompensation(-40, 40, 0.1), aeCompensation(-40, 40, 0.1))
        assertNull(aeCompensation(0, 0, 0.1)) // [0, 0]: not supported (CameraCharacteristics docs)
        assertNull(aeCompensation(null, 40, 0.1))
        assertNull(aeCompensation(-40, 40, null))
        assertNull(aeCompensation(-40, 40, 0.0))
    }
}

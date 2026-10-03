package expo.modules.lumencapture

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.os.Build
import kotlin.math.sqrt

data class FpsRange(val lower: Int, val upper: Int)

data class ManualExposureRange(val minDurationNs: Long, val maxDurationNs: Long, val minIso: Int, val maxIso: Int)

// One physical rear lens. cameraId is what CameraX opens; physicalId is set when the lens sits behind a
// logical multi-camera and is reached with Camera2Interop setPhysicalCameraId.
data class RearLens(
    val id: String,
    val cameraId: String,
    val physicalId: String?,
    val kind: String,
    val fpsRanges: List<FpsRange>,
    val torchUsable: Boolean,
    val torchLevels: Boolean,
    val exposureLock: Boolean,
    val whiteBalanceLock: Boolean,
    val focusLock: Boolean,
    val fixedFocus: Boolean,
    // Set when the lens takes manual exposure time and ISO (MANUAL_SENSOR); DSP-5 steering needs it.
    val manualExposure: ManualExposureRange?,
    val realtimeTimestamps: Boolean,
) {
    val maxFps: Int
        get() = fpsRanges.maxOfOrNull { it.upper }?.coerceAtMost(MAX_FPS) ?: 0
}

// Spec §9.2 caps the frame rate at 240 fps.
private const val MAX_FPS = 240

// 35 mm-equivalent focal length bounds. Phone main cameras sit near 24–28 mm, ultra-wides near 13–16 mm,
// and telephotos at 48 mm or longer; the cut points sit between those groups.
private const val ULTRAWIDE_BELOW_MM = 20.0
private const val TELE_ABOVE_MM = 35.0
private const val FULL_FRAME_DIAGONAL_MM = 43.27

fun lensKind(focalLengthMm: Float?, sensorWidthMm: Float?, sensorHeightMm: Float?): String {
    if (focalLengthMm == null || sensorWidthMm == null || sensorHeightMm == null) return "unknown"
    val diagonal = sqrt(sensorWidthMm.toDouble() * sensorWidthMm + sensorHeightMm.toDouble() * sensorHeightMm)
    if (diagonal <= 0.0 || focalLengthMm <= 0f) return "unknown"
    val equivalentMm = focalLengthMm * FULL_FRAME_DIAGONAL_MM / diagonal
    return when {
        equivalentMm < ULTRAWIDE_BELOW_MM -> "ultrawide"
        equivalentMm > TELE_ABOVE_MM -> "tele"
        else -> "wide"
    }
}

// Spec §9.2: the highest rate the lens supports up to the requested one (60 fps on Android). Among ranges
// with the same top rate the highest floor wins, so auto-exposure has the least room to slow the frame rate.
fun pickFpsRange(ranges: List<FpsRange>, wantFps: Int): FpsRange? {
    val allowed = ranges.filter { it.upper <= wantFps }
    if (allowed.isEmpty()) return ranges.minWithOrNull(compareBy<FpsRange> { it.upper }.thenByDescending { it.lower })
    return allowed.maxWithOrNull(compareBy<FpsRange> { it.upper }.thenBy { it.lower })
}

// Camera2 docs: a minimum focus distance of 0 means a fixed-focus lens. The key may be null on LEGACY devices,
// so null alone is not taken as fixed; a lens whose only AF mode is OFF has no autofocus to move it either.
fun isFixedFocus(afModes: IntArray, minimumFocusDistance: Float?): Boolean =
    minimumFocusDistance == 0f || (afModes.isNotEmpty() && afModes.all { it == CameraMetadata.CONTROL_AF_MODE_OFF })

// Spec §5.1 awards the focus points for a focus lock or a fixed-focus lens, and Appendix A has only `locks.focus`.
// AF mode OFF lets lockExposure() hold the current focus distance by hand.
fun focusHolds(afModes: IntArray, fixedFocus: Boolean): Boolean = fixedFocus || CameraMetadata.CONTROL_AF_MODE_OFF in afModes

// Lens ids: "<cameraId>" for a camera the OS lists directly, "<cameraId>:<physicalId>" for a physical lens
// behind a logical rear camera (spec §4.2 step 1). Logical multi-cameras themselves are never listed
// (ADR 0029: physical rear lenses only).
fun rearLenses(manager: CameraManager): List<RearLens> {
    val listed = manager.cameraIdList.toSet()
    return manager.cameraIdList.flatMap { cameraId ->
        val logical = manager.getCameraCharacteristics(cameraId)
        if (logical.get(CameraCharacteristics.LENS_FACING) != CameraMetadata.LENS_FACING_BACK) return@flatMap emptyList()
        val capabilities = logical.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
        // CameraX opens only cameras that support the standard capture pipeline.
        if (CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE !in capabilities) {
            return@flatMap emptyList()
        }
        val hidden = hiddenPhysicalIds(logical, capabilities, listed)
        when {
            hidden.isNotEmpty() ->
                hidden.map { physicalId ->
                    describe("$cameraId:$physicalId", cameraId, physicalId, logical, manager.getCameraCharacteristics(physicalId))
                }
            isLogicalCamera(capabilities) && logical.physicalIdsOrEmpty().isNotEmpty() -> emptyList()
            else -> listOf(describe(cameraId, cameraId, null, logical, logical))
        }
    }
}

private fun isLogicalCamera(capabilities: IntArray): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA in capabilities

private fun CameraCharacteristics.physicalIdsOrEmpty(): Set<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) physicalCameraIds else emptySet()

// Physical lenses the OS does not list on their own; those it does list are described directly.
private fun hiddenPhysicalIds(
    logical: CameraCharacteristics,
    capabilities: IntArray,
    listed: Set<String>,
): List<String> {
    if (!isLogicalCamera(capabilities)) return emptyList()
    return logical.physicalIdsOrEmpty().filter { it !in listed }.sorted()
}

// Requests go to the logical camera, so frame rates, torch, locks and exposure ranges come from it; the
// focal length and sensor size that decide the lens kind come from the physical lens.
private fun describe(
    id: String,
    cameraId: String,
    physicalId: String?,
    logical: CameraCharacteristics,
    lens: CameraCharacteristics,
): RearLens {
    val focal = lens.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
    val sensor = lens.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
    val afModes = logical.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: IntArray(0)
    val fixedFocus = isFixedFocus(afModes, logical.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE))
    val strengthLevels =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            logical.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL) ?: 1
        } else {
            1
        }
    val capabilities = logical.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
    val durations = logical.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
    val isoRange = logical.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
    val manual =
        if (CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR in capabilities && durations != null && isoRange != null) {
            ManualExposureRange(durations.lower, durations.upper, isoRange.lower, isoRange.upper)
        } else {
            null
        }
    return RearLens(
        id = id,
        cameraId = cameraId,
        physicalId = physicalId,
        kind = lensKind(focal, sensor?.width, sensor?.height),
        fpsRanges =
            logical.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?.map { FpsRange(it.lower, it.upper) }
                .orEmpty(),
        torchUsable = logical.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true,
        torchLevels = strengthLevels > 1,
        exposureLock = logical.get(CameraCharacteristics.CONTROL_AE_LOCK_AVAILABLE) == true,
        whiteBalanceLock = logical.get(CameraCharacteristics.CONTROL_AWB_LOCK_AVAILABLE) == true,
        focusLock = focusHolds(afModes, fixedFocus),
        fixedFocus = fixedFocus,
        manualExposure = manual,
        realtimeTimestamps =
            logical.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) ==
                CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME,
    )
}

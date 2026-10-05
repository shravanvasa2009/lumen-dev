package expo.modules.lumencapture

import kotlin.math.max

// How the live view turns the preview upright and fills the view with it, centred and cropped (PreviewView's
// FILL_CENTER). Applied as a TextureView transform: scale about the centre, then rotate about the centre.
internal data class LiveViewFit(val scaleX: Float, val scaleY: Float, val rotationDegrees: Int)

// TextureView first applies the SurfaceTexture's transform, which the camera sets to its sensor orientation when it
// writes to the surface directly (hasCameraTransform), then stretches the result to the view. The rest of the turn
// is the same as CameraX 1.6.2 PreviewTransformation.getRemainingRotationDegrees (javap): minus the target rotation
// with a camera transform, else the whole sensor-to-target rotation.
internal fun fitLiveView(
    bufferWidth: Int,
    bufferHeight: Int,
    rotationDegrees: Int,
    targetDegrees: Int,
    hasCameraTransform: Boolean,
    viewWidth: Int,
    viewHeight: Int,
): LiveViewFit {
    // Rear camera: sensor orientation = sensor-to-target rotation + target rotation.
    val cameraTurn = if (hasCameraTransform) normalDegrees(rotationDegrees + targetDegrees) else 0
    val remaining = normalDegrees(if (hasCameraTransform) -targetDegrees else rotationDegrees)
    val (shownWidth, shownHeight) = swapIfQuarterTurn(bufferWidth, bufferHeight, cameraTurn)
    val (finalWidth, finalHeight) = swapIfQuarterTurn(shownWidth, shownHeight, remaining)
    val scale = max(viewWidth.toFloat() / finalWidth, viewHeight.toFloat() / finalHeight)
    return LiveViewFit(shownWidth * scale / viewWidth, shownHeight * scale / viewHeight, remaining)
}

private fun normalDegrees(degrees: Int): Int = ((degrees % 360) + 360) % 360

private fun swapIfQuarterTurn(width: Int, height: Int, degrees: Int): Pair<Int, Int> =
    if (degrees % 180 == 0) width to height else height to width

package expo.modules.lumencapture

import java.nio.ByteBuffer
import kotlin.math.sqrt

// Means are 0..1 of full scale (Appendix A).
data class FrameNumbers(
    val r: Double,
    val g: Double,
    val b: Double,
    val spatialStdR: Double,
    val clipFrac: Double,
)

// ADR 0029: the central 60% of the frame on both axes, every 4th row and every 4th pixel.
private const val EDGE_FRACTION = 0.2
private const val GRID_STEP = 4

// ADR 0029: a sampled pixel is clipped when its red is at least 250 of 255.
private const val CLIP_LEVEL = 250

// Reduces one RGBA_8888 frame to the Appendix A numbers. Bytes in each pixel are R, G, B, A
// (CameraX ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).
fun reduceRgbaFrame(
    pixels: ByteBuffer,
    width: Int,
    height: Int,
    rowStride: Int,
    pixelStride: Int,
): FrameNumbers {
    val x0 = (width * EDGE_FRACTION).toInt()
    val y0 = (height * EDGE_FRACTION).toInt()
    val x1 = width - x0
    val y1 = height - y0
    var sumR = 0L
    var sumG = 0L
    var sumB = 0L
    var sumR2 = 0L
    var clipped = 0
    var count = 0
    var y = y0
    while (y < y1) {
        var offset = y * rowStride + x0 * pixelStride
        var x = x0
        while (x < x1) {
            val red = pixels.get(offset).toInt() and 0xFF
            sumR += red
            sumR2 += red * red
            sumG += pixels.get(offset + 1).toInt() and 0xFF
            sumB += pixels.get(offset + 2).toInt() and 0xFF
            if (red >= CLIP_LEVEL) clipped++
            count++
            offset += GRID_STEP * pixelStride
            x += GRID_STEP
        }
        y += GRID_STEP
    }
    require(count > 0) { "frame $width x $height has no pixels in the finger region" }
    val meanR = sumR.toDouble() / count
    // Population variance over the sampled pixels; clamped because rounding can make it slightly negative.
    val varianceR = (sumR2.toDouble() / count - meanR * meanR).coerceAtLeast(0.0)
    return FrameNumbers(
        r = meanR / 255.0,
        g = sumG.toDouble() / count / 255.0,
        b = sumB.toDouble() / count / 255.0,
        spatialStdR = sqrt(varianceR) / 255.0,
        clipFrac = clipped.toDouble() / count,
    )
}

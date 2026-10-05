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

// ADR 0097: the live-view thumbnail is 80 x 60 RGB8, a quarter of the 320 x 240 analysis frame on each axis.
const val PREVIEW_WIDTH = 80
const val PREVIEW_HEIGHT = 60

// ADR 0097: at most every 3rd analysis frame gets a thumbnail, about 10 per second at 30 fps.
const val PREVIEW_EVERY = 3

// Shrinks a whole RGBA_8888 frame to PREVIEW_WIDTH x PREVIEW_HEIGHT row-major RGB8 bytes for the live view (ADR
// 0097). Source pixel (x, y) falls in output pixel (x * 80 / width, y * 60 / height); each output pixel is the
// rounded mean of the source pixels that fall in it, so a 320 x 240 frame averages 4 x 4 boxes.
fun downscaleRgbaFrame(
    pixels: ByteBuffer,
    width: Int,
    height: Int,
    rowStride: Int,
    pixelStride: Int,
): ByteArray {
    require(width >= PREVIEW_WIDTH && height >= PREVIEW_HEIGHT) { "frame $width x $height is smaller than the preview" }
    val column = IntArray(width) { it * PREVIEW_WIDTH / width }
    val boxWidth = IntArray(PREVIEW_WIDTH)
    column.forEach { boxWidth[it]++ }
    val thumbnail = ByteArray(PREVIEW_WIDTH * PREVIEW_HEIGHT * 3)
    val sums = IntArray(PREVIEW_WIDTH * 3)
    var boxRows = 0
    for (y in 0 until height) {
        var offset = y * rowStride
        for (x in 0 until width) {
            val sum = column[x] * 3
            sums[sum] += pixels.get(offset).toInt() and 0xFF
            sums[sum + 1] += pixels.get(offset + 1).toInt() and 0xFF
            sums[sum + 2] += pixels.get(offset + 2).toInt() and 0xFF
            offset += pixelStride
        }
        boxRows++
        val outRow = y * PREVIEW_HEIGHT / height
        if (y + 1 == height || (y + 1) * PREVIEW_HEIGHT / height != outRow) {
            val rowStart = outRow * PREVIEW_WIDTH * 3
            for (outX in 0 until PREVIEW_WIDTH) {
                val count = boxWidth[outX] * boxRows
                for (channel in 0 until 3) {
                    thumbnail[rowStart + outX * 3 + channel] = ((sums[outX * 3 + channel] + count / 2) / count).toByte()
                }
            }
            sums.fill(0)
            boxRows = 0
        }
    }
    return thumbnail
}

// ADR 0097: decides which analysis frames get a thumbnail. The first frame after the preview turns on gets one,
// so the view fills at once, then every PREVIEW_EVERY-th frame. Analyzer thread only.
class PreviewGate {
    private var framesToSkip = 0

    fun due(enabled: Boolean): Boolean {
        if (!enabled) {
            framesToSkip = 0
            return false
        }
        if (framesToSkip > 0) {
            framesToSkip--
            return false
        }
        framesToSkip = PREVIEW_EVERY - 1
        return true
    }
}

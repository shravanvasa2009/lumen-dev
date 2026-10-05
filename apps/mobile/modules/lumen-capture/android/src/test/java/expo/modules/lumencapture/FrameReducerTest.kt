package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

private const val EPS = 1e-9

private class RgbaFrame(val width: Int, val height: Int, val rowStride: Int = width * 4) {
    val bytes = ByteBuffer.allocateDirect(rowStride * height)

    fun fill(r: Int, g: Int, b: Int) {
        for (y in 0 until height) for (x in 0 until width) set(x, y, r, g, b)
    }

    fun set(x: Int, y: Int, r: Int, g: Int, b: Int) {
        val offset = y * rowStride + x * 4
        bytes.put(offset, r.toByte())
        bytes.put(offset + 1, g.toByte())
        bytes.put(offset + 2, b.toByte())
        bytes.put(offset + 3, 255.toByte())
    }

    fun reduce() = reduceRgbaFrame(bytes, width, height, rowStride, 4)

    fun downscale() = downscaleRgbaFrame(bytes, width, height, rowStride, 4)
}

// For a 40 x 20 frame the region is x 8..31 and y 4..15, sampled at x 8, 12, ..., 28 and y 4, 8, 12.
private fun sampled(x: Int, y: Int) = x in 8..31 && y in 4..15 && (x - 8) % 4 == 0 && (y - 4) % 4 == 0

class FrameReducerTest {
    @Test
    fun uniformFrameGivesItsColourAndNoSpread() {
        val frame = RgbaFrame(40, 20).apply { fill(200, 50, 25) }
        val numbers = frame.reduce()
        assertEquals(200 / 255.0, numbers.r, EPS)
        assertEquals(50 / 255.0, numbers.g, EPS)
        assertEquals(25 / 255.0, numbers.b, EPS)
        assertEquals(0.0, numbers.spatialStdR, EPS)
        assertEquals(0.0, numbers.clipFrac, EPS)
    }

    @Test
    fun onlyTheCentralGridIsRead() {
        val frame = RgbaFrame(40, 20).apply { fill(255, 255, 255) }
        for (y in 0 until 20) for (x in 0 until 40) if (sampled(x, y)) frame.set(x, y, 100, 10, 1)
        val numbers = frame.reduce()
        assertEquals(100 / 255.0, numbers.r, EPS)
        assertEquals(10 / 255.0, numbers.g, EPS)
        assertEquals(1 / 255.0, numbers.b, EPS)
        assertEquals(0.0, numbers.clipFrac, EPS)
    }

    @Test
    fun clipFractionCountsRedAtOrAbove250() {
        val frame = RgbaFrame(40, 20).apply { fill(249, 0, 0) }
        // Sampled rows y = 4 and 12 (two of three) clip at exactly 250.
        for (x in 0 until 40) {
            frame.set(x, 4, 250, 0, 0)
            frame.set(x, 12, 250, 0, 0)
        }
        assertEquals(2.0 / 3.0, frame.reduce().clipFrac, EPS)
    }

    @Test
    fun spatialStdIsThePopulationStdOfSampledRed() {
        val frame = RgbaFrame(40, 20)
        // Sampled columns alternate between 100 and 200: mean 150, population std 50.
        for (y in 0 until 20) for (x in 0 until 40) frame.set(x, y, if ((x / 4) % 2 == 0) 100 else 200, 0, 0)
        val numbers = frame.reduce()
        assertEquals(150 / 255.0, numbers.r, EPS)
        assertEquals(50 / 255.0, numbers.spatialStdR, EPS)
    }

    @Test
    fun rowPaddingIsSkipped() {
        val frame = RgbaFrame(40, 20, rowStride = 40 * 4 + 64)
        frame.fill(80, 40, 20)
        for (y in 0 until 20) for (pad in 0 until 64) frame.bytes.put(y * frame.rowStride + 160 + pad, 255.toByte())
        assertEquals(80 / 255.0, frame.reduce().r, EPS)
    }

    @Test(expected = IllegalArgumentException::class)
    fun emptyFrameIsRejected() {
        RgbaFrame(0, 0).reduce()
    }

    @Test
    fun thumbnailIsEightyBySixtyRgbOfTheWholeFrame() {
        val frame = RgbaFrame(320, 240).apply { fill(200, 50, 25) }
        // The corner pixel lies outside the finger region yet counts as 1 of the 16 in its box: 15 x 200 / 16 = 187.5.
        frame.set(0, 0, 0, 0, 0)
        val thumbnail = frame.downscale()
        assertEquals(80 * 60 * 3, thumbnail.size)
        assertEquals(listOf(188, 47, 23), pixel(thumbnail, 0, 0))
        assertEquals(listOf(200, 50, 25), pixel(thumbnail, 79, 59))
    }

    @Test
    fun eachThumbnailPixelIsTheMeanOfItsFourByFourBox() {
        val frame = RgbaFrame(320, 240)
        // Red runs 0, 10, ..., 150 inside every box (mean 75); green and blue name the box's column and row.
        for (y in 0 until 240) for (x in 0 until 320) frame.set(x, y, (x % 4 + 4 * (y % 4)) * 10, x / 4, y / 4)
        val thumbnail = frame.downscale()
        for (outY in 0 until 60) for (outX in 0 until 80) assertEquals(listOf(75, outX, outY), pixel(thumbnail, outX, outY))
    }

    @Test
    fun aHalfwayMeanRoundsUp() {
        val frame = RgbaFrame(320, 240)
        for (y in 0 until 240) for (x in 0 until 320) frame.set(x, y, (x + y) % 2, 0, 0)
        assertEquals(listOf(1, 0, 0), pixel(frame.downscale(), 0, 0))
    }

    @Test
    fun anUnevenFrameSizeStillFillsEveryThumbnailPixel() {
        // 100 x 70 splits into boxes one or two pixels wide and tall; each box is filled with its own colour.
        val frame = RgbaFrame(100, 70)
        for (y in 0 until 70) for (x in 0 until 100) frame.set(x, y, x * 80 / 100, y * 60 / 70, 200)
        val thumbnail = frame.downscale()
        for (outY in 0 until 60) for (outX in 0 until 80) assertEquals(listOf(outX, outY, 200), pixel(thumbnail, outX, outY))
    }

    @Test
    fun thumbnailSkipsRowPadding() {
        val frame = RgbaFrame(320, 240, rowStride = 320 * 4 + 64)
        frame.fill(80, 40, 20)
        for (y in 0 until 240) for (pad in 0 until 64) frame.bytes.put(y * frame.rowStride + 320 * 4 + pad, 255.toByte())
        val thumbnail = frame.downscale()
        assertEquals(listOf(80, 40, 20), pixel(thumbnail, 79, 0))
        assertEquals(listOf(80, 40, 20), pixel(thumbnail, 79, 59))
    }

    @Test(expected = IllegalArgumentException::class)
    fun aFrameSmallerThanTheThumbnailIsRejected() {
        RgbaFrame(40, 20).downscale()
    }

    @Test
    fun theGateLetsTheFirstFrameAndThenEveryThirdThrough() {
        val gate = PreviewGate()
        assertEquals(
            listOf(true, false, false, true, false, false, true, false, false),
            List(9) { gate.due(enabled = true) },
        )
    }

    @Test
    fun theGateGivesNoFrameWhileOffAndRestartsWhenTurnedOn() {
        val gate = PreviewGate()
        assertTrue(gate.due(enabled = true))
        assertFalse(gate.due(enabled = true))
        repeat(5) { assertFalse(gate.due(enabled = false)) }
        assertTrue(gate.due(enabled = true))
        assertFalse(gate.due(enabled = true))
    }
}

private fun pixel(thumbnail: ByteArray, x: Int, y: Int): List<Int> =
    (0 until 3).map { thumbnail[(y * 80 + x) * 3 + it].toInt() and 0xFF }

package expo.modules.lumencapture

import org.junit.Assert.assertEquals
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
}

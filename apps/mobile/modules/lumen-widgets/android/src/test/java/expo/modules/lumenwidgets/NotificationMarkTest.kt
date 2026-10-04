package expo.modules.lumenwidgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.core.content.ContextCompat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private const val SIZE_PX = 200

// Android draws a small icon from its alpha only, so the lens hole and the pulse line must come out
// transparent. Native graphics really rasterizes the vector; the points are in the mark's 200 viewBox.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotificationMarkTest {
    private val mark =
        Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888).also { bitmap ->
            val drawable = ContextCompat.getDrawable(RuntimeEnvironment.getApplication(), R.drawable.lumen_notification_mark)!!
            drawable.setBounds(0, 0, SIZE_PX, SIZE_PX)
            drawable.draw(Canvas(bitmap))
        }

    private fun alphaAt(x: Int, y: Int) = Color.alpha(mark.getPixel(x, y))

    @Test
    fun theBodyIsOpaque() {
        assertEquals(255, alphaAt(120, 60))
        assertEquals(255, alphaAt(100, 170))
        assertEquals(255, alphaAt(60, 104))
    }

    @Test
    fun theLensAndThePulseLineAreCutOut() {
        assertEquals(0, alphaAt(82, 40))
        assertEquals(0, alphaAt(87, 96))
        assertEquals(0, alphaAt(102, 113))
        assertEquals(0, alphaAt(58, 116))
        assertEquals(0, alphaAt(142, 116))
    }

    @Test
    fun outsideTheBodyIsEmpty() {
        assertEquals(0, alphaAt(30, 100))
        assertEquals(0, alphaAt(170, 116))
    }
}

package expo.modules.lumencapture

import org.junit.Assert.assertEquals
import org.junit.Test

class LiveViewFitTest {
    // A portrait phone (target rotation 0) with a rear sensor mounted at 90 degrees, as on most phones.
    @Test
    fun cameraTransformAlreadyTurnsThePreviewUpright() {
        val fit = fitLiveView(640, 480, 90, 0, true, 176, 176)
        assertEquals(0, fit.rotationDegrees)
        // Shown 480 wide by 640 tall: the width fills the circle, the extra height is cropped.
        assertEquals(1f, fit.scaleX, 1e-4f)
        assertEquals(640f / 480f, fit.scaleY, 1e-4f)
    }

    @Test
    fun withoutCameraTransformTheViewTurnsIt() {
        val fit = fitLiveView(640, 480, 90, 0, false, 176, 176)
        assertEquals(90, fit.rotationDegrees)
        // Scaled to 234.7 x 176 before the quarter turn, so it covers 176 x 234.7 after it.
        assertEquals(640f / 480f, fit.scaleX, 1e-4f)
        assertEquals(1f, fit.scaleY, 1e-4f)
    }

    @Test
    fun tallViewIsCoveredWithTheSidesCropped() {
        val fit = fitLiveView(640, 480, 90, 0, true, 100, 200)
        val scale = 200f / 640f
        assertEquals(480 * scale / 100, fit.scaleX, 1e-4f)
        assertEquals(1f, fit.scaleY, 1e-4f)
    }

    // Landscape (target 90): the camera transform turns the buffer to the natural portrait orientation and the view
    // turns it back by the display rotation.
    @Test
    fun landscapeTurnsBackByTheDisplayRotation() {
        val fit = fitLiveView(640, 480, 0, 90, true, 200, 150)
        assertEquals(270, fit.rotationDegrees)
        val scale = maxOf(200f / 640f, 150f / 480f)
        assertEquals(480 * scale / 200, fit.scaleX, 1e-4f)
        assertEquals(640 * scale / 150, fit.scaleY, 1e-4f)
    }
}

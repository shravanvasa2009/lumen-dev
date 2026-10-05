package expo.modules.lumencapture

import androidx.camera.core.CameraControl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CancellationException

class TorchOutcomeTest {
    // The two messages CameraX 1.6.2 TorchControl uses (strings in camera-camera2-1.6.2 classes.jar).
    @Test
    fun cameraXCancellationIsSuperseded() {
        val newer = CameraControl.OperationCanceledException("There is a new enableTorch being set")
        val closed = CameraControl.OperationCanceledException("Camera is not active.")
        assertTrue(isSupersededTorchRequest(newer))
        assertTrue(isSupersededTorchRequest(closed))
        assertEquals("superseded, There is a new enableTorch being set", torchOutcomeText(newer))
    }

    @Test
    fun otherFailuresStayFailures() {
        val refused = IllegalStateException("torch busy")
        assertFalse(isSupersededTorchRequest(refused))
        assertFalse(isSupersededTorchRequest(CancellationException("cancelled")))
        assertFalse(isSupersededTorchRequest(null))
        assertEquals("failed, $refused", torchOutcomeText(refused))
        assertEquals("ok", torchOutcomeText(null))
    }
}

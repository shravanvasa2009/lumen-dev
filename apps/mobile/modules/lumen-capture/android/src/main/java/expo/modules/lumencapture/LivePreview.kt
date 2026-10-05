package expo.modules.lumencapture

import android.graphics.SurfaceTexture
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.annotation.RequiresApi
import androidx.camera.core.SurfaceRequest
import java.util.concurrent.Executor

private const val TAG = "LumenCapture"

// The SurfaceTexture the camera writes the running capture's preview into. Owned here, not by a view, so the
// preview surface exists from bind() to stop() and a live view can come and go without touching the session.
internal class PreviewStream(val texture: SurfaceTexture, val size: Size) {
    var transform: SurfaceRequest.TransformationInfo? = null

    // True while a TextureView holds the texture: that view then releases it when it is replaced or detached.
    var shown = false
    var ended = false
}

// Connects the running capture's Preview use case (ADR 0099) to the one live view on screen. Main thread only:
// CameraX calls the provider and its callbacks on the main executor, and views live there.
//
// Why the texture is owned here: in CameraX 1.6.2 (javap), Preview.setSurfaceProvider() with a provider on a bound
// Preview calls notifyReset(), and UseCaseManager.reset() closes and rebuilds the camera graph, whose
// TorchControl.reset() turns the torch off and whose new session restarts AE. A provider set once before binding,
// that answers with this texture whether or not a view is on screen, keeps the session the same shape throughout.
// With no view on screen nobody draws the texture, and that does not hold the camera back: the camera service forces
// asynchronous mode for a GPU-texture consumer (SessionConfigurationUtils.cpp) and skips the dequeue timeout that
// would end it (Camera3OutputStream::configureQueueLocked), so a frame nobody draws is replaced, not waited on.
// PreviewView's TextureViewImplementation relies on the same while its view is detached.
internal object LivePreview {
    private var stream: PreviewStream? = null
    private var view: LumenPreviewView? = null
    private val mainExecutor = Executor { Handler(Looper.getMainLooper()).post(it) }

    @RequiresApi(Build.VERSION_CODES.O)
    fun provide(request: SurfaceRequest) {
        val size = request.resolution
        // The detached-mode constructor (API 26): the TextureView that shows it attaches it to its own GL context.
        val texture = SurfaceTexture(false).apply { setDefaultBufferSize(size.width, size.height) }
        val surface = Surface(texture)
        val next = PreviewStream(texture, size)
        stream = next
        request.setTransformationInfoListener(mainExecutor) { transform ->
            next.transform = transform
            if (stream === next) view?.fit()
        }
        request.provideSurface(surface, mainExecutor) { outcome ->
            surface.release()
            next.ended = true
            if (!next.shown) texture.release()
            if (stream === next) stream = null
            Log.i(TAG, "Live view preview stream ${sizeText(next)} ended: ${surfaceResultText(outcome.resultCode)}")
        }
        Log.i(TAG, "Live view preview stream ${sizeText(next)} ready, ${if (view == null) "no view attached" else "shown"}")
        view?.show(next)
    }

    fun attach(attached: LumenPreviewView) {
        // One view shows the texture at a time; the newest one wins, e.g. a screen pushed over another.
        view?.takeIf { it !== attached }?.yieldTexture()
        view = attached
        Log.i(TAG, "Live view attached, preview resolution ${sizeText(stream)}")
        stream?.let { attached.show(it) }
    }

    fun detach(detached: LumenPreviewView) {
        if (view !== detached) return
        view = null
        Log.i(TAG, "Live view detached, preview resolution ${sizeText(stream)}")
    }

    // The TextureView's onSurfaceTextureDestroyed answer: keep the live stream's texture for the next view, release
    // anything else (its own texture, or a stream the camera has finished with).
    fun releaseOnDetach(texture: SurfaceTexture): Boolean {
        val live = stream?.takeIf { it.texture === texture && !it.ended } ?: return true
        live.shown = false
        return false
    }
}

private fun sizeText(stream: PreviewStream?): String = stream?.let { "${it.size.width}x${it.size.height}" } ?: "none (no preview stream)"

private fun surfaceResultText(code: Int): String =
    when (code) {
        SurfaceRequest.Result.RESULT_SURFACE_USED_SUCCESSFULLY -> "used"
        SurfaceRequest.Result.RESULT_REQUEST_CANCELLED -> "request cancelled"
        SurfaceRequest.Result.RESULT_INVALID_SURFACE -> "invalid surface"
        SurfaceRequest.Result.RESULT_SURFACE_ALREADY_PROVIDED -> "already provided"
        SurfaceRequest.Result.RESULT_WILL_NOT_PROVIDE_SURFACE -> "not provided"
        else -> "result $code"
    }

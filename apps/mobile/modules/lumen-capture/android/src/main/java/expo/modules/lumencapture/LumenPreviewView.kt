package expo.modules.lumencapture

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// The live fingertip view (ADR 0099): the running capture's preview, drawn natively. No props and no events; no
// frame or image reaches JS (CAP-3). A TextureView, not a SurfaceView, so the parent's round clip applies to it.
class LumenPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private var shown: PreviewStream? = null

    private val textureView =
        TextureView(context).apply {
            surfaceTextureListener =
                object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) = Unit

                    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) = Unit

                    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
                        if (shown?.texture === texture) shown = null
                        return LivePreview.releaseOnDetach(texture)
                    }

                    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit
                }
        }

    init {
        addView(textureView)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        LivePreview.attach(this)
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        LivePreview.detach(this)
    }

    // React Native sizes this view; the TextureView fills it.
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        textureView.layout(0, 0, right - left, bottom - top)
        fit()
    }

    internal fun show(stream: PreviewStream) {
        if (textureView.parent == null) {
            addView(textureView)
            // React Native lays out only this view, not its native children, so a re-added child needs its bounds.
            textureView.layout(0, 0, width, height)
        }
        // setSurfaceTexture() releases the texture the view held, so it is never called with the one it holds.
        if (textureView.surfaceTexture !== stream.texture) textureView.setSurfaceTexture(stream.texture)
        stream.shown = true
        shown = stream
        fit()
    }

    // Another live view took the texture. Removing the TextureView detaches the texture from its GL context
    // (TextureView.onSurfaceTextureDestroyed returns false for the live stream), so the other view can attach it.
    internal fun yieldTexture() {
        removeView(textureView)
    }

    internal fun fit() {
        val stream = shown ?: return
        val transform = stream.transform ?: return
        if (width == 0 || height == 0) return
        val fit =
            fitLiveView(
                stream.size.width,
                stream.size.height,
                transform.rotationDegrees,
                surfaceRotationDegrees(transform.targetRotation),
                transform.hasCameraTransform(),
                width,
                height,
            )
        val centreX = width / 2f
        val centreY = height / 2f
        textureView.setTransform(
            Matrix().apply {
                postScale(fit.scaleX, fit.scaleY, centreX, centreY)
                postRotate(fit.rotationDegrees.toFloat(), centreX, centreY)
            },
        )
    }
}

private fun surfaceRotationDegrees(rotation: Int): Int =
    when (rotation) {
        Surface.ROTATION_90 -> 90
        Surface.ROTATION_180 -> 180
        Surface.ROTATION_270 -> 270
        else -> 0
    }

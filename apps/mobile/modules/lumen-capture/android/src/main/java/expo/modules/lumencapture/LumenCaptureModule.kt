package expo.modules.lumencapture

import android.Manifest
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.LifecycleOwner
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import kotlin.math.roundToInt

// @OptimizedRecord lets Expo 57 convert the record from generated introspection data instead of reflection
// (expo-modules-core 57.0.20 RecordTypeConverter; same pattern as @expo/dom-webview).
@OptimizedRecord
data class CaptureConfig(
    @Field val lensId: String? = null,
    @Field val targetFps: Double? = null,
    @Field val torchLevel: Double? = null,
    @Field val exposureTarget: List<Double>? = null,
) : Record

// Spec §9.2 (Android): request 60 fps where the lens supports it, else 30; high-speed sessions are out of scope.
private const val ANDROID_MAX_FPS = 60

// The Appendix A contract (src/LumenCapture.types.ts) for Android, with the ADR 0013 additions.
class LumenCaptureModule : Module() {
    private var session: CameraSession? = null

    // ADR 0097: the preview event runs only while JS listens to it and has not turned it off. Set from Expo's
    // async queue and read on the analyzer thread, so both are volatile.
    @Volatile private var previewListening = false

    @Volatile private var previewAllowed = true

    private val context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private fun lenses(): List<RearLens> = rearLenses(context.getSystemService(CameraManager::class.java))

    override fun definition() =
        ModuleDefinition {
            Name("LumenCapture")

            Events("samples", "status", "lab", "preview")

            // Expo calls these when the first JS listener for "preview" is added and after the last is removed
            // (expo-modules-core 57.0.20 EventEmitter.cpp). Neither touches the running session.
            OnStartObserving("preview") { previewListening = true }

            OnStopObserving("preview") { previewListening = false }

            AsyncFunction("setPreviewEnabled") { enabled: Boolean -> previewAllowed = enabled }

            AsyncFunction("getCapabilities") { describeCapabilities(lenses()) }

            AsyncFunction("getPermission") { promise: Promise ->
                Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
            }

            AsyncFunction("requestPermission") { promise: Promise ->
                Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
            }

            AsyncFunction("start") { config: CaptureConfig, promise: Promise ->
                startSession(config, promise)
            }.runOnQueue(Queues.MAIN)

            AsyncFunction("stop") { promise: Promise ->
                val running = session ?: return@AsyncFunction promise.reject(CAPTURE_ERROR, "stop needs a running capture", null)
                session = null
                val summary = running.stop()
                promise.resolve(
                    mapOf(
                        "startedNs" to summary.startedNs.toDouble(),
                        "stoppedNs" to summary.stoppedNs.toDouble(),
                        "lensId" to summary.lensId,
                        "frames" to summary.frames.toDouble(),
                        "dropped" to summary.dropped.toDouble(),
                    ),
                )
            }.runOnQueue(Queues.MAIN)

            AsyncFunction("setTorch") { level: Double, promise: Promise ->
                val running = session ?: return@AsyncFunction promise.reject(CAPTURE_ERROR, "setTorch() needs a running capture", null)
                running.setTorch(level.coerceIn(0.0, 1.0)) { failure -> settle(promise, failure) }
            }.runOnQueue(Queues.MAIN)

            AsyncFunction("lockExposure") { promise: Promise ->
                val running = session ?: return@AsyncFunction promise.reject(CAPTURE_ERROR, "lockExposure() needs a running capture", null)
                running.lockExposure { failure -> settle(promise, failure) }
            }.runOnQueue(Queues.MAIN)

            // CameraX unbinding must happen on the main thread.
            OnDestroy {
                val running = session ?: return@OnDestroy
                session = null
                Handler(Looper.getMainLooper()).post { running.stop() }
            }
        }

    private fun startSession(config: CaptureConfig, promise: Promise) {
        // ADR 0029 addendum: start() while running stops the old capture (its last batch goes out) and starts
        // again with the new config, as Swift and ReplayCapture do.
        session?.let {
            session = null
            it.stop()
        }
        if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return promise.reject(CAPTURE_ERROR, "camera permission is not granted", null)
        }
        val owner =
            appContext.currentActivity as? LifecycleOwner
                ?: return promise.reject(CAPTURE_ERROR, "no foreground activity to run the camera in", null)
        val lenses = lenses()
        val lens =
            config.lensId?.let { id -> lenses.find { it.id == id } ?: return promise.reject(CAPTURE_ERROR, "no rear lens with id $id", null) }
                ?: defaultLens(lenses)
                ?: return promise.reject(CAPTURE_ERROR, "this phone reports no usable rear camera", null)
        // ADR 0029 addendum: an explicit targetFps is clamped, never rejected; 0 or less counts as omitted.
        val wantFps = config.targetFps?.takeIf { it > 0 }?.roundToInt()?.coerceIn(1, ANDROID_MAX_FPS) ?: ANDROID_MAX_FPS
        val fps =
            pickFpsRange(lens.fpsRanges, wantFps)
                ?: return promise.reject(CAPTURE_ERROR, "lens ${lens.id} reports no frame-rate ranges", null)
        // ADR 0029 addendum: without torchLevel the torch is on at level 1; 0 is ambient mode (spec §4.4).
        val torchLevel = (config.torchLevel ?: 1.0).coerceIn(0.0, 1.0)
        if (torchLevel > 0 && !lens.torchUsable) {
            return promise.reject(CAPTURE_ERROR, "the ${lens.kind} lens has no usable torch; start with torchLevel 0", null)
        }
        val exposureTarget =
            exposureWindow(config.exposureTarget)
                ?: return promise.reject(CAPTURE_ERROR, "exposureTarget must be two increasing values within 0..1", null)
        val started =
            CameraSession(
                context,
                SessionSettings(lens, fps, torchLevel, exposureTarget, BuildConfig.DEBUG),
                previewWanted = { previewListening && previewAllowed },
            ) { name, body -> sendEvent(name, body) }
        session = started
        started.start(owner) { failure ->
            if (failure != null) {
                if (session === started) session = null
                started.stop()
                return@start settle(promise, failure)
            }
            // ADR 0067: the top of the AE target range set on every request. It comes from the lens's own
            // CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES, so the camera must accept it; it can be below targetFps.
            promise.resolve(mapOf("activeFps" to fps.upper.toDouble()))
        }
    }

    private fun settle(promise: Promise, failure: Throwable?) {
        if (failure == null) promise.resolve(null) else promise.reject(CAPTURE_ERROR, failure.message ?: failure.toString(), failure)
    }
}

// The main (wide) lens is the usual default; core's lens selection (spec §4.2) passes lensId otherwise.
private fun defaultLens(lenses: List<RearLens>): RearLens? = lenses.firstOrNull { it.kind == "wide" } ?: lenses.firstOrNull()

private fun describeCapabilities(lenses: List<RearLens>): Map<String, Any?> {
    // Locks describe the lens start({}) opens, since core asks for locks on that lens unless it picks another.
    val main = defaultLens(lenses)
    return mapOf(
        "platform" to "android",
        "modelId" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "osVersion" to Build.VERSION.RELEASE,
        "rearLenses" to
            lenses.map {
                mapOf("id" to it.id, "kind" to it.kind, "maxFps" to it.maxFps, "torchUsable" to it.torchUsable)
            },
        "torch" to mapOf("available" to lenses.any { it.torchUsable }, "levels" to lenses.any { it.torchLevels }),
        "locks" to
            mapOf(
                // lockExposure() holds a manual exposure where the lens allows it, else an AE lock (as Swift).
                "exposure" to (main != null && main.exposureHold != ExposureHold.NONE),
                "whiteBalance" to (main?.whiteBalanceLock ?: false),
                "focus" to (main?.focusLock ?: false),
            ),
    )
}

// ADR 0029 addendum: every rejection uses this one code with a plain message, as in Swift; JS never branches on it.
private const val CAPTURE_ERROR = "ERR_LUMEN_CAPTURE"

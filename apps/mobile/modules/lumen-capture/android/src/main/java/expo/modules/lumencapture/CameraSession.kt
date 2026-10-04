package expo.modules.lumencapture

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt
import kotlin.math.roundToLong

data class SessionSettings(
    val lens: RearLens,
    val fps: FpsRange,
    val torchLevel: Double,
    val exposureTarget: ClosedFloatingPointRange<Double>,
    val labEvents: Boolean,
)

data class SessionSummary(val startedNs: Long, val stoppedNs: Long, val lensId: String, val frames: Long, val dropped: Long)

// The newest capture-result values the Lab event and the exposure steering need.
private data class ResultSnapshot(
    val iso: Int,
    val exposureNs: Long,
    val torchOn: Boolean,
    val aeLocked: Boolean,
    val awbLocked: Boolean,
    val afLocked: Boolean,
    val focusDistance: Float?,
)

// The Camera2 options this session adds on top of CameraX's own request. Changed only on the exposure thread.
private data class RequestState(
    val manual: ExposureSetting? = null,
    val aeLock: Boolean = false,
    val awbLock: Boolean = false,
    val focusDistance: Float? = null,
)

private const val TAG = "LumenCapture"

// Spec §9.2: a small analysis size; 320 x 240 keeps the per-frame reduction far below the 4 ms budget.
private val ANALYSIS_SIZE = Size(320, 240)
private const val BATCH_MS = 100L // samples event, spec §9.3
private const val STATUS_MS = 250L // status event at 4 Hz
private const val LAB_MS = 1000L // lab event at 1 Hz (ADR 0013)
private const val MOTION_PERIOD_US = 20_000 // 50 Hz (ADR 0029)

// ADR 0029 addendum, same values as the Swift module: at most 4 exposure steps, each judged on 3 frames
// taken at least EXPOSURE_LATENCY_MS (0.2 s) after the change.
private const val MAX_EXPOSURE_STEPS = 4
private const val FRESH_FRAMES = 3
private const val FRESH_FRAME_POLL_MS = 20L
private const val ANALYZER_DRAIN_MS = 100L
private const val EVENT_DRAIN_MS = 50L
private const val FAILURE_LOG_EVERY = 100

// start() fails when the camera has not delivered a frame and set the torch within this time of bind, instead of
// leaving the JS promise waiting on a stuck camera. 5 s, not 3: budget HALs can take 2-3 s to open plus the torch.
private const val START_TIMEOUT_MS = 5000L

// One running capture: CameraX ImageAnalysis on a rear lens with Camera2 interop for frame rate,
// stabilization, exposure and locks (spec §9.2). Frames are reduced to numbers on the analyzer thread and
// never leave this class (CAP-3).
@OptIn(markerClass = [ExperimentalCamera2Interop::class])
class CameraSession(
    private val context: Context,
    private val settings: SessionSettings,
    private val emit: (String, Map<String, Any?>) -> Unit,
) {
    private val lens = settings.lens
    private val frameIntervalNs = 1_000_000_000L / settings.fps.upper
    private val counters = CaptureCounters(frameIntervalNs)
    private val exposureLog = ExposureLog()
    private val motion = MotionWindow()
    private val analyzerThread: ExecutorService = Executors.newSingleThreadExecutor()

    // lockExposure() waits for frames between steps, as the Swift module does on its session queue.
    private val exposureThread: ExecutorService = Executors.newSingleThreadExecutor()
    private val eventThread = HandlerThread("LumenCaptureEvents").apply { start() }
    private val events = Handler(eventThread.looper)
    private val mainExecutor = Executor { Handler(Looper.getMainLooper()).post(it) }

    // Only this session's start timer and first-frame note are posted here, so stop() can cancel just those.
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sensorManager = context.getSystemService(SensorManager::class.java)
    private val powerManager = context.getSystemService(PowerManager::class.java)

    @Volatile private var latest: ResultSnapshot? = null

    @Volatile private var frameWidth = 0

    @Volatile private var frameHeight = 0

    @Volatile private var torchLevel = 0.0

    // The level the caller asked for, restored whenever the camera reopens (ADR 0029 addendum).
    @Volatile private var requestedTorch = settings.torchLevel

    @Volatile private var running = false

    // When the first frame arrived (elapsedRealtimeNanos); the lock's settle wait counts from here.
    @Volatile private var firstFrameRealtimeNs: Long? = null

    // One lockExposure() at a time; a second call while one steers rejects (as in the Swift module).
    private val locking = AtomicBoolean(false)

    @Volatile private var camera: Camera? = null
    private var added = RequestState()
    private var startedNs = 0L
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var stopped = false // main thread only
    private var seenOpen = false // main thread only
    private var reopened = false // main thread only
    private val analysisFailures = AtomicInteger(0)

    // start()'s callback until the start succeeds or fails, then null. Main thread only, like the fields below.
    private var startDone: ((Throwable?) -> Unit)? = null
    private var torchReady = false
    private var frameReady = false
    private var lastCameraError: CameraState.StateError? = null
    private var summary: SessionSummary? = null

    private val startTimeout =
        Runnable {
            val missing = if (!frameReady) "delivered no frames" else "did not set the torch"
            val lastError = lastCameraError?.let { "; last camera error: ${cameraErrorText(it.code)}" } ?: ""
            finishStart(IllegalStateException("The camera $missing within ${START_TIMEOUT_MS / 1000} s of opening$lastError"))
        }

    private val firstFrameArrived =
        Runnable {
            frameReady = true
            if (torchReady) finishStart(null)
        }

    // CameraX 1.6.2 resets its torch control when the use cases detach (lifecycle STOP), so the camera
    // reopens dark after the app returns from the background (PR #47 review, javap on camera-camera2 1.6.2).
    // Swift restores the torch after an interruption the same way.
    private val cameraStateObserver =
        Observer<CameraState> { state ->
            val error = state.error
            if (error == null) {
                Log.i(TAG, "Camera state ${state.type}")
            } else {
                Log.e(TAG, "Camera state ${state.type}, ${error.type} error: ${cameraErrorText(error.code)}", error.cause)
                lastCameraError = error
                // CameraX retries a RECOVERABLE error itself, so a start fails on one only through the timeout.
                // Posted, not called: LiveData can deliver its current value inside observe(), and failing the start
                // there would run the caller's stop() in the middle of bind().
                if (error.type == CameraState.ErrorType.CRITICAL) {
                    val failure = IllegalStateException("Camera error: ${cameraErrorText(error.code)}", error.cause)
                    mainHandler.post { finishStart(failure) }
                }
            }
            if (state.type == CameraState.Type.OPEN) {
                if (reopened) restoreAfterReopen()
                seenOpen = true
                reopened = false
            } else if (seenOpen) {
                reopened = true
            }
        }

    // Main thread. `done` runs once: when the torch is set and the first frame has arrived, or with the failure (a
    // bind error, a critical camera error, a torch error, START_TIMEOUT_MS, or stop()). On failure the caller
    // still calls stop(), which unbinds the camera; closing the camera turns the torch off.
    fun start(owner: LifecycleOwner, done: (Throwable?) -> Unit) {
        startDone = done
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            // stop() has already failed this start.
            if (stopped) return@addListener
            val outcome = runCatching { bind(owner, providerFuture.get()) }
            outcome.exceptionOrNull()?.let {
                finishStart(it)
                return@addListener
            }
            // stop() ran while binding: it has unbound the camera, so no torch and no timer for a dead session.
            if (stopped) return@addListener
            mainHandler.postDelayed(startTimeout, START_TIMEOUT_MS)
            setTorch(settings.torchLevel) { failure ->
                if (failure != null) return@setTorch finishStart(failure)
                torchReady = true
                if (frameReady) finishStart(null)
            }
        }, mainExecutor)
    }

    private fun finishStart(failure: Throwable?) {
        val done = startDone ?: return
        startDone = null
        mainHandler.removeCallbacks(startTimeout)
        if (failure == null) Log.i(TAG, "Capture started") else Log.e(TAG, "Capture start failed", failure)
        done(failure)
    }

    private fun bind(owner: LifecycleOwner, cameraProvider: ProcessCameraProvider) {
        val builder =
            ImageAnalysis.Builder()
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(ANALYSIS_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                        ).build(),
                )
        val interop =
            Camera2Interop.Extender(builder)
                .setCaptureRequestOption(
                    CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                    Range(settings.fps.lower, settings.fps.upper),
                ).setCaptureRequestOption(
                    CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                    CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF,
                ).setSessionCaptureCallback(resultListener)
        if (lens.physicalId != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            interop.setPhysicalCameraId(lens.physicalId)
        }
        val useCase = builder.build()
        useCase.setAnalyzer(analyzerThread, ::analyze)
        val selector =
            CameraSelector.Builder()
                .requireLensFacing(CameraSelector.LENS_FACING_BACK)
                .addCameraFilter { infos -> infos.filter { Camera2CameraInfo.from(it).getCameraId() == lens.cameraId } }
                .build()
        startedNs = frameClockNs()
        val bound = cameraProvider.bindToLifecycle(owner, selector, useCase)
        // Recorded straight after binding, so a stop() from here on unbinds the camera, which closes it and puts
        // the torch out.
        camera = bound
        provider = cameraProvider
        analysis = useCase
        logBound()
        running = true
        sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)?.let {
            sensorManager.registerListener(motionListener, it, MOTION_PERIOD_US, events)
        }
        events.postDelayed(::emitBatch, BATCH_MS)
        events.postDelayed(::emitStatus, STATUS_MS)
        if (settings.labEvents) events.postDelayed(::emitLab, LAB_MS)
        // Last, once the session is fully set up: observe() can call the observer at once with the current state.
        bound.cameraInfo.cameraState.observe(owner, cameraStateObserver)
    }

    // Logcat in release builds too, so a first run on a new phone shows which camera path it took. Camera
    // settings only; never a health value (CAP-3 keeps frames native, and no reading is computed here).
    private fun logBound() {
        val manual = if (lens.manualExposure != null) "on" else "off"
        val clock = if (lens.realtimeTimestamps) "realtime" else "unknown"
        Log.i(
            TAG,
            "Camera bound: lens ${lens.id} (${lens.kind}), cameraId ${lens.cameraId}, physicalId ${lens.physicalId ?: "none"}, " +
                "fps range ${settings.fps.lower}-${settings.fps.upper}, manual exposure $manual, " +
                "hardware level ${hardwareLevelName(lens.hardwareLevel)}, timestamps $clock",
        )
    }

    // Main thread. The last samples batch goes out before this returns, so stop() loses no frame (as in Swift).
    // A second call (the failed-start callback stops again) returns the same summary.
    fun stop(): SessionSummary {
        summary?.let { return it }
        stopped = true
        running = false
        mainHandler.removeCallbacks(startTimeout)
        // A frame still in analyze() can post firstFrameArrived after this; it is harmless because finishStart()
        // below clears startDone, so the late note finds no start to finish.
        mainHandler.removeCallbacks(firstFrameArrived)
        camera?.cameraInfo?.cameraState?.removeObserver(cameraStateObserver)
        analysis?.let { useCase ->
            useCase.clearAnalyzer()
            provider?.unbind(useCase)
        }
        sensorManager?.unregisterListener(motionListener)
        events.removeCallbacksAndMessages(null)
        analyzerThread.shutdown()
        // A frame still in analyze() takes well under 1 ms (Lab frame work), so this bound is generous.
        analyzerThread.awaitTermination(ANALYZER_DRAIN_MS, TimeUnit.MILLISECONDS)
        // A batch the event thread is sending right now goes out first, so batches stay in time order.
        eventThread.quitSafely()
        eventThread.join(EVENT_DRAIN_MS)
        emitBatchNow()
        // Interrupts a lockExposure() that is waiting for frames, so its promise rejects.
        exposureThread.shutdownNow()
        val finished = SessionSummary(startedNs, frameClockNs(), lens.id, counters.frames, counters.dropped)
        summary = finished
        finishStart(IllegalStateException("capture stopped before the camera started"))
        return finished
    }

    // Runs on the exposure thread so stop() never waits for it; stop() interrupts it and the promise rejects.
    fun lockExposure(done: (Throwable?) -> Unit) {
        if (!locking.compareAndSet(false, true)) return done(IllegalStateException("lockExposure is already running"))
        exposureThread.execute {
            val failure = runCatching { lockOnExposureThread() }.exceptionOrNull()
            locking.set(false)
            done(failure)
        }
    }

    // Frame timestamps use the sensor's clock (SENSOR_INFO_TIMESTAMP_SOURCE), so the summary does too.
    private fun frameClockNs(): Long = if (lens.realtimeTimestamps) SystemClock.elapsedRealtimeNanos() else System.nanoTime()

    // A throw here would escape CameraX's analyzer executor and crash the app, so a failed frame is counted,
    // logged, and skipped; the skipped frame then shows up as a dropped frame.
    private fun analyze(image: ImageProxy) {
        try {
            reduceAndCount(image)
        } catch (e: RuntimeException) {
            val failures = analysisFailures.incrementAndGet()
            if (failures == 1 || failures % FAILURE_LOG_EVERY == 0) Log.e(TAG, "Frame reduction failed ($failures so far)", e)
        }
    }

    private fun reduceAndCount(image: ImageProxy) {
        image.use {
            val workStart = System.nanoTime()
            val plane = it.planes[0]
            if (firstFrameRealtimeNs == null) {
                firstFrameRealtimeNs = SystemClock.elapsedRealtimeNanos()
                Log.i(TAG, "First frame: ${it.width}x${it.height}, rowStride ${plane.rowStride}, pixelStride ${plane.pixelStride}")
                mainHandler.post(firstFrameArrived)
            }
            val numbers = reduceRgbaFrame(plane.buffer, it.width, it.height, plane.rowStride, plane.pixelStride)
            val workNs = System.nanoTime() - workStart
            val tNs = it.imageInfo.timestamp
            frameWidth = it.width
            frameHeight = it.height
            val overexposed =
                counters.addFrame(
                    CapturedFrame(tNs, numbers, exposureLog.exposureAt(tNs)),
                    SystemClock.elapsedRealtimeNanos(),
                    workNs,
                )
            if (overexposed) onExposureThread(::relieveOverexposure)
        }
    }

    private fun onExposureThread(task: () -> Unit) {
        try {
            exposureThread.execute(task)
        } catch (e: RejectedExecutionException) {
            // stop() already shut the exposure thread; a stopped capture has nothing left to adjust.
            Log.i(TAG, "Exposure task skipped after stop", e)
        }
    }

    // Main thread, when the camera is OPEN again after an interruption.
    private fun restoreAfterReopen() {
        setTorch(requestedTorch) { failure -> failure?.let { Log.e(TAG, "Restoring the torch failed", it) } }
        // Camera2 interop options should survive a reopen; re-sending the held exposure and locks is cheap.
        onExposureThread {
            if (added != RequestState()) {
                runCatching { applyRequest(added) }.onFailure { Log.e(TAG, "Restoring the exposure lock failed", it) }
            }
        }
    }

    // DSP-5 as decided in ADR 0029 and its addendum: steer exposure until the red mean sits inside
    // exposureTarget, then hold exposure, white balance and focus (spec §4.2 step 3, ADR 0013).
    private fun lockOnExposureThread() {
        check(running) { "lockExposure needs a running capture" }
        // Spec §4.2 step 3 lets auto-exposure settle for 1 s; the ADR 0029 addendum stretches that to the lock
        // wait (at least 1 s, longer on a slow camera).
        val firstWaitMs =
            settleWaitMs(lockWaitMs(counters.lockIntervalNs()), firstFrameRealtimeNs, SystemClock.elapsedRealtimeNanos())
        val manual = lens.manualExposure
        if (manual != null) {
            steerExposure(manual, firstWaitMs)
        } else {
            // As in Swift, the settle ends with a fresh-frame read, so a stalled camera rejects instead of locking.
            freshRed(firstWaitMs)
            if (lens.exposureLock) applyRequest(added.copy(aeLock = true))
        }
        // getCapabilities() reported locks.focus for this lens, so a distance is always set: the one autofocus
        // reached on the finger, else the closest the lens can focus (the finger touches the lens).
        val focusDistance =
            if (lens.focusLock && !lens.fixedFocus) latest?.focusDistance ?: lens.minimumFocusDistance else null
        applyRequest(added.copy(awbLock = lens.whiteBalanceLock, focusDistance = focusDistance))
        Log.i(TAG, "Locks applied: white balance ${lens.whiteBalanceLock}, focus distance ${focusDistance ?: "not set"}")
        counters.armOverexposureWatch()
    }

    private fun steerExposure(manual: ManualExposureRange, firstWaitMs: Long) {
        var steps = 0
        var red = freshRed(firstWaitMs)
        while (red !in settings.exposureTarget && steps < MAX_EXPOSURE_STEPS) {
            scaleExposure(manual, exposureFactor(red, settings.exposureTarget))
            steps++
            red = freshRed(EXPOSURE_LATENCY_MS)
        }
        // Already inside the target: hold the camera's own exposure as a manual one.
        if (added.manual == null) scaleExposure(manual, 1.0)
        Log.i(TAG, "Exposure held after $steps steps: red $red, ${added.manual}")
    }

    // DSP-5: red stayed above 0.95 after the lock, so lower the exposure one step and hold it (ADR 0029). Core
    // sees the change in exposureNs and marks the span as artifact.
    private fun relieveOverexposure() {
        val manual = lens.manualExposure ?: return
        if (!running) return
        runCatching { scaleExposure(manual, exposureFactor(counters.lastRed ?: 1.0, settings.exposureTarget)) }
            .onFailure { Log.e(TAG, "Lowering the exposure failed", it) }
    }

    private fun scaleExposure(manual: ManualExposureRange, factor: Double) {
        val current =
            added.manual
                ?: latest?.let { ExposureSetting(it.exposureNs.toDouble(), it.iso.toDouble()) }
                ?: throw IllegalStateException("No capture result has reported the exposure yet")
        val limits =
            ExposureLimits(
                minDurationNs = manual.minDurationNs.toDouble(),
                maxDurationNs = minOf(manual.maxDurationNs, frameIntervalNs).toDouble(),
                minIso = manual.minIso.toDouble(),
                maxIso = manual.maxIso.toDouble(),
            )
        applyRequest(added.copy(manual = planExposure(current, factor, limits)))
    }

    // The red mean of a frame taken after the latest exposure change.
    private fun freshRed(waitMs: Long): Double {
        val before = counters.frames
        Thread.sleep(waitMs)
        val deadline = SystemClock.elapsedRealtime() + lockWaitMs(counters.lockIntervalNs())
        while (SystemClock.elapsedRealtime() < deadline) {
            val red = counters.lastRed
            if (counters.frames - before >= FRESH_FRAMES && red != null) return red
            Thread.sleep(FRESH_FRAME_POLL_MS)
        }
        throw IllegalStateException("No camera frames arrived while setting exposure")
    }

    private fun applyRequest(next: RequestState) {
        val control = camera?.cameraControl ?: throw IllegalStateException("camera is not running")
        val options = CaptureRequestOptions.Builder()
        next.manual?.let { manual ->
            // AE off holds this exposure; the frame duration keeps the chosen rate. The torch stays on because
            // FLASH_MODE still applies with AE off (CaptureRequest.FLASH_MODE docs).
            options
                .setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
                .setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, manual.durationNs.roundToLong())
                .setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, manual.iso.roundToInt())
                .setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, frameIntervalNs)
        }
        if (next.aeLock) options.setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, true)
        if (next.awbLock) options.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_LOCK, true)
        next.focusDistance?.let {
            options
                .setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                .setCaptureRequestOption(CaptureRequest.LENS_FOCUS_DISTANCE, it)
        }
        val waitMs = lockWaitMs(counters.lockIntervalNs())
        try {
            Camera2CameraControl.from(control).setCaptureRequestOptions(options.build()).get(waitMs, TimeUnit.MILLISECONDS)
        } catch (e: ExecutionException) {
            throw IllegalStateException("The camera rejected the exposure settings", e.cause ?: e)
        } catch (e: TimeoutException) {
            throw IllegalStateException("The camera did not apply the exposure settings within $waitMs ms", e)
        }
        added = next
    }

    private val resultListener =
        object : CameraCaptureSession.CaptureCallback() {
            override fun onCaptureCompleted(
                session: CameraCaptureSession,
                request: CaptureRequest,
                captureResult: TotalCaptureResult,
            ) {
                val exposureNs = captureResult.get(CaptureResult.SENSOR_EXPOSURE_TIME) ?: 0L
                captureResult.get(CaptureResult.SENSOR_TIMESTAMP)?.let { exposureLog.record(it, exposureNs) }
                val afState = captureResult.get(CaptureResult.CONTROL_AF_STATE)
                latest =
                    ResultSnapshot(
                        iso = captureResult.get(CaptureResult.SENSOR_SENSITIVITY) ?: 0,
                        exposureNs = exposureNs,
                        torchOn = captureResult.get(CaptureResult.FLASH_MODE) == CaptureResult.FLASH_MODE_TORCH,
                        // A manual exposure (AE off) is held as firmly as an AE lock.
                        aeLocked =
                            captureResult.get(CaptureResult.CONTROL_AE_MODE) == CaptureResult.CONTROL_AE_MODE_OFF ||
                                captureResult.get(CaptureResult.CONTROL_AE_STATE) == CaptureResult.CONTROL_AE_STATE_LOCKED,
                        awbLocked = captureResult.get(CaptureResult.CONTROL_AWB_STATE) == CaptureResult.CONTROL_AWB_STATE_LOCKED,
                        afLocked =
                            lens.fixedFocus ||
                                captureResult.get(CaptureResult.CONTROL_AF_MODE) == CaptureResult.CONTROL_AF_MODE_OFF ||
                                afState == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED ||
                                afState == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED,
                        focusDistance = captureResult.get(CaptureResult.LENS_FOCUS_DISTANCE),
                    )
            }
        }

    // Sensor values are stamped on arrival with the same clock the status timer reads.
    private val motionListener =
        object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                motion.add(SystemClock.elapsedRealtimeNanos(), event.values[0], event.values[1], event.values[2])
            }

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
        }

    private fun emitBatch() {
        emitBatchNow()
        events.postDelayed(::emitBatch, BATCH_MS)
    }

    private fun emitBatchNow() {
        val batch = counters.drainBatch()
        if (batch.isEmpty()) return
        emit(
            "samples",
            mapOf(
                "samples" to batch.map { mapOf("tNs" to it.tNs.toDouble(), "r" to it.numbers.r, "g" to it.numbers.g, "b" to it.numbers.b) },
                "stats" to
                    batch.map {
                        mapOf(
                            "tNs" to it.tNs.toDouble(),
                            "spatialStdR" to it.numbers.spatialStdR,
                            "clipFrac" to it.numbers.clipFrac,
                            "exposureNs" to it.exposureNs.toDouble(),
                        )
                    },
            ),
        )
    }

    private fun emitStatus() {
        val nowNs = SystemClock.elapsedRealtimeNanos()
        val numbers = counters.status(nowNs)
        val thermal =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && powerManager != null) {
                thermalName(powerManager.currentThermalStatus)
            } else {
                "nominal"
            }
        emit(
            "status",
            mapOf(
                "fingerCovered" to numbers.fingerCovered,
                "motionRms" to motion.rmsG(nowNs),
                "thermal" to thermal,
                "fps" to numbers.fps,
                "droppedFrac" to numbers.droppedFrac,
            ),
        )
        events.postDelayed(::emitStatus, STATUS_MS)
    }

    private fun emitLab() {
        val work = counters.takeFrameWork()
        val snapshot = latest
        emit(
            "lab",
            mapOf(
                "lensId" to lens.id,
                "formatWidth" to frameWidth,
                "formatHeight" to frameHeight,
                "targetFps" to settings.fps.upper,
                "frameWorkMsMean" to work.mean,
                "frameWorkMsMax" to work.max,
                "iso" to (snapshot?.iso ?: 0),
                "exposureNs" to (snapshot?.exposureNs ?: 0L).toDouble(),
                "torchOn" to (snapshot?.torchOn ?: false),
                "torchLevel" to torchLevel,
                "locked" to
                    mapOf(
                        "exposure" to (snapshot?.aeLocked ?: false),
                        "whiteBalance" to (snapshot?.awbLocked ?: false),
                        "focus" to (snapshot?.afLocked ?: false),
                    ),
            ),
        )
        events.postDelayed(::emitLab, LAB_MS)
    }

    fun setTorch(level: Double, done: (Throwable?) -> Unit) {
        requestedTorch = level
        val active = camera ?: return done(IllegalStateException("camera is not running"))
        val control = active.cameraControl
        val cameraInfo = active.cameraInfo
        if (!cameraInfo.hasFlashUnit()) {
            Log.i(TAG, "Torch: the camera reports no flash unit")
            return done(if (level > 0) UnsupportedOperationException("this lens has no torch") else null)
        }
        control.enableTorch(level > 0).whenDone { failure ->
            Log.i(TAG, "Torch ${if (level > 0) "on" else "off"}: ${failure?.let { "failed, $it" } ?: "ok"}")
            if (failure != null || level <= 0 || !cameraInfo.isTorchStrengthSupported) {
                if (failure == null) torchLevel = if (level > 0) 1.0 else 0.0
                return@whenDone done(failure)
            }
            val maxLevel = cameraInfo.maxTorchStrengthLevel
            val strength = (level * maxLevel).roundToInt().coerceIn(1, maxLevel)
            control.setTorchStrengthLevel(strength).whenDone { strengthFailure ->
                Log.i(TAG, "Torch strength $strength of $maxLevel: ${strengthFailure?.let { "failed, $it" } ?: "ok"}")
                if (strengthFailure == null) torchLevel = strength.toDouble() / maxLevel
                done(strengthFailure)
            }
        }
    }

    private fun <T> ListenableFuture<T>.whenDone(block: (Throwable?) -> Unit) {
        addListener({
            val failure =
                try {
                    get()
                    null
                } catch (e: ExecutionException) {
                    e.cause ?: e
                } catch (e: CancellationException) {
                    e
                }
            block(failure)
        }, mainExecutor)
    }
}

// CameraState.ERROR_* codes (CameraX 1.6.2) in words the failure message carries to JS.
private fun cameraErrorText(code: Int): String =
    when (code) {
        CameraState.ERROR_MAX_CAMERAS_IN_USE -> "too many cameras are open (ERROR_MAX_CAMERAS_IN_USE)"
        CameraState.ERROR_CAMERA_IN_USE -> "another app is using the camera (ERROR_CAMERA_IN_USE)"
        CameraState.ERROR_OTHER_RECOVERABLE_ERROR -> "the camera closed unexpectedly (ERROR_OTHER_RECOVERABLE_ERROR)"
        CameraState.ERROR_STREAM_CONFIG -> "the camera rejected the stream setup (ERROR_STREAM_CONFIG)"
        CameraState.ERROR_CAMERA_DISABLED -> "the camera is disabled by a device policy (ERROR_CAMERA_DISABLED)"
        CameraState.ERROR_CAMERA_FATAL_ERROR -> "the camera hit a fatal error; restarting the phone may help (ERROR_CAMERA_FATAL_ERROR)"
        CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED ->
            "the camera cannot open while Do Not Disturb is on (ERROR_DO_NOT_DISTURB_MODE_ENABLED)"
        CameraState.ERROR_CAMERA_REMOVED -> "the camera was disconnected (ERROR_CAMERA_REMOVED)"
        else -> "camera error code $code"
    }

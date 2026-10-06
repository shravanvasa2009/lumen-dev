package expo.modules.lumencapture

import android.os.PowerManager
import kotlin.math.roundToLong
import kotlin.math.sqrt

data class CapturedFrame(val tNs: Long, val numbers: FrameNumbers, val exposureNs: Long)

data class StatusNumbers(val fingerCovered: Boolean, val fps: Double, val droppedFrac: Double)

data class FrameWorkMs(val mean: Double, val max: Double)

private const val ONE_SECOND_NS = 1_000_000_000L

// DSP-1 (ADR 0029, corrected 2026-10-01): a gap longer than 1.5x the median interval hides
// round(gap / median) - 1 frames. As in the Swift module, the median covers the intervals that ended in the
// 1 s before the frame; the nominal interval stands in until 5 exist.
private const val DROP_GAP_FACTOR = 1.5
private const val MIN_MEDIAN_INTERVALS = 5

// DSP-5 (ADR 0029 addendum): red above 0.95 for 0.5 s after the lock asks for one exposure step down.
private const val OVEREXPOSED_RED = 0.95
private const val OVEREXPOSED_FOR_NS = 500_000_000L

// The analyzer thread adds frames while the event thread drains batches and reads status, so every
// method that touches shared state is synchronized.
class CaptureCounters(private val nominalIntervalNs: Long) {
    private val pending = ArrayList<CapturedFrame>()
    private val arrivalsNs = ArrayDeque<Long>()
    private var lastFrameNs: Long? = null
    private val intervalEndsNs = ArrayDeque<Long>()
    private val intervalsNs = ArrayDeque<Long>()
    private val lastIntervalsNs = ArrayDeque<Long>()
    private var newestSinceStatus: FrameNumbers? = null
    private val work = TimingWindow()
    private var watchArmed = false
    private var overexposedSinceNs: Long? = null

    var frames = 0L
        @Synchronized get
        private set
    var dropped = 0L
        @Synchronized get
        private set
    var lastRed: Double? = null
        @Synchronized get
        private set

    // The newest frame, for the once-a-second contact log; unlike newestSinceStatus, reading it changes nothing.
    var lastFrame: CapturedFrame? = null
        @Synchronized get
        private set

    init {
        require(nominalIntervalNs > 0) { "nominal frame interval must be positive" }
    }

    // Returns true once when the armed DSP-5 watch sees red above 0.95 for 0.5 s.
    @Synchronized
    fun addFrame(frame: CapturedFrame, arrivalNs: Long, workNs: Long): Boolean {
        countDropped(frame.tNs)
        frames++
        lastRed = frame.numbers.r
        lastFrame = frame
        pending.add(frame)
        newestSinceStatus = frame.numbers
        arrivalsNs.addLast(arrivalNs)
        dropOldArrivals(arrivalNs)
        work.add(workNs)
        return watchOverexposure(frame.numbers.r, frame.tNs)
    }

    // ADR 0029 addendum: lockExposure() waits use the median of the last 5 measured intervals whatever their age
    // (nominal until 5 exist), so they still work below 5 fps, where the DSP-1 1 s window holds fewer than 5.
    @Synchronized
    fun lockIntervalNs(): Double = medianIntervalNs(lastIntervalsNs) ?: nominalIntervalNs.toDouble()

    @Synchronized
    fun armOverexposureWatch() {
        watchArmed = true
        overexposedSinceNs = null
    }

    // Frames since the previous call; the 100 ms samples event (spec §9.3).
    @Synchronized
    fun drainBatch(): List<CapturedFrame> {
        val batch = pending.toList()
        pending.clear()
        return batch
    }

    // fps counts frames that arrived in the last 1 s, so it falls to 0 when frames stop (ADR 0029);
    // droppedFrac covers the whole capture (ADR 0013). Contact is judged on the newest frame since the
    // previous status, as in the Swift module, so a stalled camera reports no contact.
    @Synchronized
    fun status(nowNs: Long): StatusNumbers {
        dropOldArrivals(nowNs)
        val covered = newestSinceStatus?.let(::fingerCovered) ?: false
        newestSinceStatus = null
        val seen = frames + dropped
        return StatusNumbers(
            fingerCovered = covered,
            fps = arrivalsNs.size.toDouble(),
            droppedFrac = if (seen > 0) dropped.toDouble() / seen else 0.0,
        )
    }

    // Frames that arrived in the last 1 s, the same count status() reports as fps.
    @Synchronized
    fun recentFps(nowNs: Long): Double {
        dropOldArrivals(nowNs)
        return arrivalsNs.size.toDouble()
    }

    // Per-frame reduction time since the previous call, for the Lab event (budget < 4 ms at 60 fps, §9.3).
    fun takeFrameWork(): FrameWorkMs = work.take()

    private fun countDropped(tNs: Long) {
        val previous = lastFrameNs
        lastFrameNs = tNs
        if (previous == null) return
        while (intervalEndsNs.isNotEmpty() && intervalEndsNs.first() <= tNs - ONE_SECOND_NS) {
            intervalEndsNs.removeFirst()
            intervalsNs.removeFirst()
        }
        val referenceNs = medianIntervalNs(intervalsNs) ?: nominalIntervalNs.toDouble()
        val gapNs = tNs - previous
        if (gapNs > DROP_GAP_FACTOR * referenceNs) dropped += (gapNs / referenceNs).roundToLong() - 1
        intervalEndsNs.addLast(tNs)
        intervalsNs.addLast(gapNs)
        lastIntervalsNs.addLast(gapNs)
        if (lastIntervalsNs.size > MIN_MEDIAN_INTERVALS) lastIntervalsNs.removeFirst()
    }

    private fun watchOverexposure(red: Double, tNs: Long): Boolean {
        if (!watchArmed || red <= OVEREXPOSED_RED) {
            overexposedSinceNs = null
            return false
        }
        val since = overexposedSinceNs ?: tNs.also { overexposedSinceNs = it }
        if (tNs - since < OVEREXPOSED_FOR_NS) return false
        watchArmed = false
        overexposedSinceNs = null
        return true
    }

    private fun dropOldArrivals(nowNs: Long) {
        while (arrivalsNs.isNotEmpty() && nowNs - arrivalsNs.first() >= ONE_SECOND_NS) arrivalsNs.removeFirst()
    }
}

// Mean and max of durations added since the previous take(), in ms; 0 and 0 when none were added. One thread
// adds while another takes.
class TimingWindow {
    private var count = 0
    private var sumNs = 0L
    private var maxNs = 0L

    @Synchronized
    fun add(ns: Long) {
        count++
        sumNs += ns
        if (ns > maxNs) maxNs = ns
    }

    @Synchronized
    fun take(): FrameWorkMs {
        val window = if (count == 0) FrameWorkMs(0.0, 0.0) else FrameWorkMs(sumNs / 1e6 / count, maxNs / 1e6)
        count = 0
        sumNs = 0
        maxNs = 0
        return window
    }
}

// Exposure arrives in Camera2 capture results on the camera thread and frames on the analyzer thread; the
// two share the sensor timestamp, so recent results are kept and looked up by it.
class ExposureLog(private val capacity: Int = 32) {
    private val timestamps = LongArray(capacity)
    private val exposures = LongArray(capacity)
    private var count = 0
    private var next = 0

    @Synchronized
    fun record(sensorTimestampNs: Long, exposureNs: Long) {
        timestamps[next] = sensorTimestampNs
        exposures[next] = exposureNs
        next = (next + 1) % capacity
        if (count < capacity) count++
    }

    // The result with this timestamp, else the newest one before it, else the newest of all; 0 before any.
    @Synchronized
    fun exposureAt(frameTimestampNs: Long): Long {
        var best = -1
        var newest = -1
        for (i in 0 until count) {
            val t = timestamps[i]
            if (t == frameTimestampNs) return exposures[i]
            if (newest < 0 || t > timestamps[newest]) newest = i
            if (t < frameTimestampNs && (best < 0 || t > timestamps[best])) best = i
        }
        return when {
            best >= 0 -> exposures[best]
            newest >= 0 -> exposures[newest]
            else -> 0L
        }
    }
}

// Median of the given frame intervals, or null with fewer than 5.
fun medianIntervalNs(intervalsNs: Collection<Long>): Double? {
    val intervals = intervalsNs.sorted()
    if (intervals.size < MIN_MEDIAN_INTERVALS) return null
    val middle = intervals.size / 2
    return if (intervals.size % 2 == 1) intervals[middle].toDouble() else (intervals[middle - 1] + intervals[middle]) / 2.0
}

// DSP-4 initial values (spec §10), copied here because native code cannot read packages/core/src/config.ts.
// This is only the live hint; @lumen/core recomputes contact and is authoritative (ADR 0013).
private const val CONTACT_MIN_RED_RATIO = 2.0
private const val CONTACT_MIN_RED = 0.30
private const val CONTACT_MAX_STD_R = 0.10

// The same test as core's frameProblem() (packages/core/src/contact.ts): DSP-4's ratio, red level and spatial
// spread decide contact. Clipping above 5% is a separate problem there (a covered frame with the "clipping"
// cause), so it does not clear the hint: with the torch on and exposure not yet locked, a covered finger can
// clip, and a hint that said "not covered" kept JS from ever asking for the lock. Clipping still reaches JS in
// every frame's clipFrac. As in core, a channel outside 0..1 or a non-finite stat is not covered.
fun fingerCovered(frame: FrameNumbers): Boolean =
    listOf(frame.r, frame.g, frame.b).all { it in 0.0..1.0 } &&
        frame.spatialStdR.isFinite() &&
        frame.clipFrac.isFinite() &&
        frame.r >= CONTACT_MIN_RED_RATIO * (frame.g + frame.b) &&
        frame.r >= CONTACT_MIN_RED &&
        frame.spatialStdR <= CONTACT_MAX_STD_R

// Android has seven thermal levels and the contract has iOS's four. PowerManager docs: LIGHT and MODERATE
// throttle "where UX is not (largely) impacted", like iOS "fair"; SEVERE "where UX is largely impacted",
// like "serious".
fun thermalName(status: Int): String =
    when (status) {
        PowerManager.THERMAL_STATUS_NONE -> "nominal"
        PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> "fair"
        PowerManager.THERMAL_STATUS_SEVERE -> "serious"
        else -> "critical"
    }

private const val STANDARD_GRAVITY = 9.80665 // m/s² per g

// ADR 0029: RMS of gravity-removed acceleration over the last 1 s, in g. Fed by TYPE_LINEAR_ACCELERATION
// (m/s²) and read by the status timer, both on the event thread, so it needs no locking.
class MotionWindow {
    private val times = ArrayDeque<Long>()
    private val squares = ArrayDeque<Double>()
    private var sumSquares = 0.0

    fun add(tNs: Long, x: Float, y: Float, z: Float) {
        val square = (x.toDouble() * x + y.toDouble() * y + z.toDouble() * z) / (STANDARD_GRAVITY * STANDARD_GRAVITY)
        times.addLast(tNs)
        squares.addLast(square)
        sumSquares += square
        dropOld(tNs)
    }

    fun rmsG(nowNs: Long): Double {
        dropOld(nowNs)
        if (squares.isEmpty()) return 0.0
        return sqrt((sumSquares / squares.size).coerceAtLeast(0.0))
    }

    private fun dropOld(nowNs: Long) {
        while (times.isNotEmpty() && nowNs - times.first() >= ONE_SECOND_NS) {
            times.removeFirst()
            sumSquares -= squares.removeFirst()
        }
    }
}

package expo.modules.lumencapture

import android.os.PowerManager
import kotlin.math.roundToLong
import kotlin.math.sqrt

data class CapturedFrame(val tNs: Long, val numbers: FrameNumbers, val exposureNs: Long)

data class StatusNumbers(val fingerCovered: Boolean, val fps: Double, val droppedFrac: Double)

data class FrameWorkMs(val mean: Double, val max: Double)

private const val ONE_SECOND_NS = 1_000_000_000L

// ADR 0029 (DSP-1): a gap longer than 1.5x the nominal interval hides round(gap / interval) - 1 frames.
private const val DROP_GAP_FACTOR = 1.5

// The analyzer thread adds frames while the event thread drains batches and reads status, so every
// method that touches shared state is synchronized.
class CaptureCounters(private val nominalIntervalNs: Long) {
    private val pending = ArrayList<CapturedFrame>()
    private val arrivalsNs = ArrayDeque<Long>()
    private val sinceStatus = ArrayList<FrameNumbers>()
    private var lastFrameNs: Long? = null
    private var workCount = 0
    private var workSumNs = 0L
    private var workMaxNs = 0L

    var frames = 0L
        @Synchronized get
        private set
    var dropped = 0L
        @Synchronized get
        private set

    init {
        require(nominalIntervalNs > 0) { "nominal frame interval must be positive" }
    }

    @Synchronized
    fun addFrame(frame: CapturedFrame, arrivalNs: Long, workNs: Long) {
        val previous = lastFrameNs
        if (previous != null) {
            val gapNs = frame.tNs - previous
            if (gapNs > DROP_GAP_FACTOR * nominalIntervalNs) {
                dropped += (gapNs.toDouble() / nominalIntervalNs).roundToLong() - 1
            }
        }
        lastFrameNs = frame.tNs
        frames++
        pending.add(frame)
        sinceStatus.add(frame.numbers)
        arrivalsNs.addLast(arrivalNs)
        dropOldArrivals(arrivalNs)
        workCount++
        workSumNs += workNs
        if (workNs > workMaxNs) workMaxNs = workNs
    }

    // Frames since the previous call; the 100 ms samples event (spec §9.3).
    @Synchronized
    fun drainBatch(): List<CapturedFrame> {
        val batch = pending.toList()
        pending.clear()
        return batch
    }

    // fps counts frames that arrived in the last 1 s, so it falls to 0 when frames stop (ADR 0029);
    // droppedFrac covers the whole capture (ADR 0013).
    @Synchronized
    fun status(nowNs: Long): StatusNumbers {
        dropOldArrivals(nowNs)
        val covered = sinceStatus.isNotEmpty() && fingerCovered(averageOf(sinceStatus))
        sinceStatus.clear()
        val seen = frames + dropped
        return StatusNumbers(
            fingerCovered = covered,
            fps = arrivalsNs.size.toDouble(),
            droppedFrac = if (seen > 0) dropped.toDouble() / seen else 0.0,
        )
    }

    // Per-frame reduction time since the previous call, for the Lab event (budget < 4 ms at 60 fps, §9.3).
    @Synchronized
    fun takeFrameWork(): FrameWorkMs {
        val work =
            if (workCount == 0) {
                FrameWorkMs(0.0, 0.0)
            } else {
                FrameWorkMs(workSumNs / 1e6 / workCount, workMaxNs / 1e6)
            }
        workCount = 0
        workSumNs = 0
        workMaxNs = 0
        return work
    }

    private fun dropOldArrivals(nowNs: Long) {
        while (arrivalsNs.isNotEmpty() && nowNs - arrivalsNs.first() >= ONE_SECOND_NS) arrivalsNs.removeFirst()
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

private fun averageOf(all: List<FrameNumbers>): FrameNumbers =
    FrameNumbers(
        r = all.sumOf { it.r } / all.size,
        g = all.sumOf { it.g } / all.size,
        b = all.sumOf { it.b } / all.size,
        spatialStdR = all.sumOf { it.spatialStdR } / all.size,
        clipFrac = all.sumOf { it.clipFrac } / all.size,
    )

// DSP-4 initial values (spec §10), copied here because native code cannot read packages/core/src/config.ts.
// This is only the live hint; @lumen/core recomputes contact and is authoritative (ADR 0013).
private const val CONTACT_MIN_RED_RATIO = 2.0
private const val CONTACT_MIN_RED = 0.30
private const val CONTACT_MAX_STD_R = 0.10
private const val CONTACT_MAX_CLIP = 0.05

fun fingerCovered(frame: FrameNumbers): Boolean =
    frame.r >= CONTACT_MIN_RED_RATIO * (frame.g + frame.b) &&
        frame.r >= CONTACT_MIN_RED &&
        frame.spatialStdR <= CONTACT_MAX_STD_R &&
        frame.clipFrac <= CONTACT_MAX_CLIP

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

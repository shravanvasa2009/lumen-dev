package expo.modules.lumenwidgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import org.json.JSONObject

// The lock-screen ring empties over the day after a check, so a full ring means a check today. It shows only when
// the user last checked, which the line beside it already says, never what the check found (WID-2).
private const val FRESH_HOURS = 24
private const val HOUR_MS = 3_600_000L

// What the lock-screen widget draws (WID-2): the ring, the app's name, "Last check n h ago" or "No checks yet", and
// Check now. It has no field for a status, a value or a check's name, so nothing it is given can show one, whatever
// the snapshot holds. Every string comes from lockscreen.json, or before the first publish from the res copies of it.
internal data class LockView(
    val name: String,
    val line: String,
    val checkNow: String,
    // 1 right after a check, falling to 0 a day later; 0 before the first check.
    val freshness: Float,
    // The dark palette in either phone theme: a lock screen is dark behind its widgets (Widgets mockup).
    val palette: Palette,
)

internal fun freshness(lastReadingMs: Long?, nowMs: Long): Float =
    if (lastReadingMs == null) 0f else (1f - (nowMs - lastReadingMs).toFloat() / (FRESH_HOURS * HOUR_MS)).coerceIn(0f, 1f)

// Reads only the snapshot's last reading time; status, hrBpm and the flags are never touched.
internal fun lockView(snapshotJson: String, displayJson: String, nowMs: Long): LockView {
    val snapshot = snapshotOf(snapshotJson)
    val display = JSONObject(displayJson)
    val lock = display.getJSONObject("lock")
    val lastReadingAt = snapshot.stringOrNull("lastReadingAt")
    return LockView(
        name = display.getString("name"),
        line =
            lastReadingAt?.let { lock.getString("lastCheck").replace("{{hours}}", hoursSince(it, nowMs).toString()) }
                ?: display.getJSONObject("empty").getString("title"),
        checkNow = lock.getString("checkNow"),
        freshness = freshness(lastReadingAt?.let(::parseUtcSeconds), nowMs),
        palette = paletteOf(display.getJSONObject("palette").getJSONObject("dark")),
    )
}

// Before the app first publishes. An app updated from a version without the lock copy also lands here until its
// next launch publishes, so for that while the widget says "No checks yet" even after readings.
internal fun fallbackLockView(context: Context) =
    LockView(
        name = context.applicationInfo.loadLabel(context.packageManager).toString(),
        line = context.getString(R.string.lumen_widget_lock_no_checks),
        checkNow = context.getString(R.string.lumen_widget_lock_check_now),
        freshness = 0f,
        palette = fallbackDark(context),
    )

// The lock-screen hub gives a widget about 4 x 3 launcher cells (https://android-developers.googleblog.com/2025/03/
// widgets-on-lock-screen-faq.html); this design scales into that and into the smaller keyguard slots other hosts use.
private val LOCK_DESIGN = DpSize(300.dp, 110.dp)

// Below this width the button would squeeze the name and line onto three lines; the whole card still opens the check.
private val LOCK_BUTTON_MIN_WIDTH = 220.dp

// The Live Activity card's see-through dark (Widgets mockup, rgba 28 28 30 / 0.82), here the dark surface at 85%.
// lumen_widget_lock_glass holds the same mix for the static picker preview.
private const val GLASS_ALPHA = 0.85f

// The ring's stroke as a share of its size: 5 of 40 in the mockup.
private const val RING_STROKE_SHARE = 5f / 40f

// Glance draws no arcs, so the freshness ring is drawn into a bitmap. Its colors are fixed (the dark palette), so a
// bitmap loses nothing that a day/night color would give.
internal fun ringBitmap(sizePx: Int, fraction: Float, track: Int, arc: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val stroke = sizePx * RING_STROKE_SHARE
    val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
        }
    val bounds = RectF(stroke / 2, stroke / 2, sizePx - stroke / 2, sizePx - stroke / 2)
    val canvas = Canvas(bitmap)
    canvas.drawOval(bounds, paint.apply { color = track })
    // Clockwise from the top, as the home widget's ring.
    if (fraction > 0f) canvas.drawArc(bounds, -90f, 360f * fraction, false, paint.apply { color = arc })
    return bitmap
}

@Composable
private fun FreshnessRing(view: LockView, size: Dp) {
    val density = LocalContext.current.resources.displayMetrics.density
    val ring = ringBitmap((size.value * density).toInt(), view.freshness, view.palette.ringTrack.toInt(), view.palette.text.toInt())
    Box(modifier = GlanceModifier.size(size), contentAlignment = Alignment.Center) {
        Image(ImageProvider(ring), contentDescription = null, modifier = GlanceModifier.fillMaxSize())
        Mark(ColorProvider(Color(view.palette.text)), ColorProvider(Color(view.palette.surface)), size * 0.46f, null)
    }
}

// The whole card opens lumen://check. MainActivity doesn't declare showWhenLocked, so Android asks the user to unlock
// before the app opens, as the lock-screen widget FAQ requires.
@Composable
internal fun LockBody(view: LockView) {
    val size = LocalSize.current
    val scale = scaleFor(size, LOCK_DESIGN)
    val check = actionStartActivity(linkIntent(LocalContext.current, CHECK_LINK))
    val colors = WidgetColors("dark", view.palette, view.palette)
    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(Color(view.palette.surface).copy(alpha = GLASS_ALPHA)))
                .cornerRadius(CARD_RADIUS.dp)
                .padding((14 * scale).dp)
                .clickable(check),
    ) {
        Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            FreshnessRing(view, (52 * scale).dp)
            Spacer(GlanceModifier.width((14 * scale).dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    view.name,
                    style = TextStyle(color = colors.of { it.text }, fontSize = (15 * scale).sp, fontWeight = FontWeight.Bold),
                    maxLines = 1,
                )
                Text(view.line, style = TextStyle(color = colors.of { it.textDim }, fontSize = (15 * scale).sp), maxLines = 2)
            }
            if (size.width >= LOCK_BUTTON_MIN_WIDTH) {
                Spacer(GlanceModifier.width((12 * scale).dp))
                Pill(colors, view.checkNow, check, true, scale, GlanceModifier.width((112 * scale).dp), MEDIUM_PILL_HEIGHT)
            }
        }
    }
}

// Exact, like the home-screen widgets, so the layout is drawn for the slot the host really gives.
class LockWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val stored = WidgetStore.readLock(context, System.currentTimeMillis())
        provideContent {
            val view by remember { WidgetStore.lockViews(context) }.collectAsState(initial = stored)
            LockBody(view ?: fallbackLockView(context))
        }
    }
}

class LockWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LockWidget()
}

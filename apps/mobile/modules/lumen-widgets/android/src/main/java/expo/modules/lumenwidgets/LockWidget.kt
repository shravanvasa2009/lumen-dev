package expo.modules.lumenwidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import org.json.JSONObject

// What the lock-screen widget draws (WID-2): the app's name, "Last check n h ago" or "No checks yet", and Check now.
// It has no field for a status, a value or a check's name, so nothing it is given can show one, whatever the
// snapshot holds. Every string comes from lockscreen.json, or before the first publish from the res copies of it.
internal data class LockView(
    val name: String,
    val line: String,
    val checkNow: String,
    val colors: WidgetColors,
)

// Reads only the snapshot's last reading time and theme; status, hrBpm and the flags are never touched.
internal fun lockView(snapshotJson: String, displayJson: String, nowMs: Long): LockView {
    val snapshot = snapshotOf(snapshotJson)
    val display = JSONObject(displayJson)
    val lock = display.getJSONObject("lock")
    val palettes = display.getJSONObject("palette")
    val lastReadingAt = snapshot.stringOrNull("lastReadingAt")
    return LockView(
        name = display.getString("name"),
        line =
            lastReadingAt?.let { lock.getString("lastCheck").replace("{{hours}}", hoursSince(it, nowMs).toString()) }
                ?: display.getJSONObject("empty").getString("title"),
        checkNow = lock.getString("checkNow"),
        colors =
            WidgetColors(
                snapshot.getString("theme"),
                paletteOf(palettes.getJSONObject("light")),
                paletteOf(palettes.getJSONObject("dark")),
            ),
    )
}

// Before the app first publishes. An app updated from a version without the lock copy also lands here until its
// next launch publishes, so for that while the widget says "No checks yet" even after readings.
internal fun fallbackLockView(context: Context) =
    LockView(
        name = context.applicationInfo.loadLabel(context.packageManager).toString(),
        line = context.getString(R.string.lumen_widget_lock_no_checks),
        checkNow = context.getString(R.string.lumen_widget_lock_check_now),
        colors = WidgetColors("system", fallbackLight(context), fallbackDark(context)),
    )

// The lock-screen hub gives a widget about 4 x 3 launcher cells (https://android-developers.googleblog.com/2025/03/
// widgets-on-lock-screen-faq.html); this design scales into that and into the smaller keyguard slots other hosts use.
private val LOCK_DESIGN = DpSize(300.dp, 120.dp)

// Below this width the button would squeeze the status onto three lines; the whole card still opens the check.
private val LOCK_BUTTON_MIN_WIDTH = 220.dp

// The whole card opens lumen://check. MainActivity doesn't declare showWhenLocked, so Android asks the user to unlock
// before the app opens, as the lock-screen widget FAQ requires.
@Composable
internal fun LockBody(view: LockView) {
    val size = LocalSize.current
    val scale = scaleFor(size, LOCK_DESIGN)
    val check = actionStartActivity(linkIntent(LocalContext.current, CHECK_LINK))
    Card(view.colors, scale, GlanceModifier.clickable(check)) {
        Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Mark(view.colors, (36 * scale).dp, null)
            Spacer(GlanceModifier.width((14 * scale).dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(view.name, style = TextStyle(color = view.colors.of { it.textDim }, fontSize = (15 * scale).sp), maxLines = 1)
                Text(
                    view.line,
                    style = TextStyle(color = view.colors.of { it.text }, fontSize = (20 * scale).sp, fontWeight = FontWeight.Bold),
                    maxLines = 2,
                )
            }
            if (size.width >= LOCK_BUTTON_MIN_WIDTH) {
                Spacer(GlanceModifier.width((12 * scale).dp))
                Pill(view.colors, view.checkNow, check, true, scale, GlanceModifier.width((120 * scale).dp), MEDIUM_PILL_HEIGHT)
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

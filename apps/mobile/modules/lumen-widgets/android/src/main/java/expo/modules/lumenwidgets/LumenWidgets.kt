package expo.modules.lumenwidgets

import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.collection.intSetOf
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

// The Widgets mockup draws the small widget at 170 x 170 pt and the medium at 364 x 170; a launcher's 2 x 2 and 4 x 2
// cells run smaller, so the design sizes below are about Android's usual cells. Every size is multiplied by the
// scale for the cell the launcher actually gives.
private val SMALL_DESIGN = DpSize(150.dp, 150.dp)
private val MEDIUM_DESIGN = DpSize(330.dp, 150.dp)

// Below 0.75 the text gets too small to read; above 1.3 a very large cell would get oversized text. The
// layout's flexible spacers absorb what the clamp leaves.
private const val MIN_SCALE = 0.75f
private const val MAX_SCALE = 1.3f

// In the smallest cells a two-line status leaves no room for the line under it.
private const val ROOMY_SCALE = 0.9f
private const val ONE_LINE_TITLE_CHARS = 12

// The mark's body is 88 x 172 in the brand SVG.
private const val MARK_ASPECT = 88f / 172f

// The medium widget's button column, as a share of its width (148 of the mockup's 332 inner width).
private const val BUTTON_COLUMN_SHARE = 0.45f
private const val SMALL_PILL_HEIGHT = 32
internal const val MEDIUM_PILL_HEIGHT = 40

internal const val CARD_RADIUS = 22

internal fun scaleFor(size: DpSize, design: DpSize): Float =
    minOf(size.width / design.width, size.height / design.height).coerceIn(MIN_SCALE, MAX_SCALE)

// The app theme wins when the user picked one; "system" follows the phone's light or dark mode.
internal class WidgetColors(private val theme: String, private val light: Palette, private val dark: Palette) {
    fun of(pick: (Palette) -> Long): ColorProvider {
        val day = Color(pick(light))
        val night = Color(pick(dark))
        return when (theme) {
            "light" -> ColorProvider(day, day)
            "dark" -> ColorProvider(night, night)
            else -> ColorProvider(day, night)
        }
    }
}

// The small widget's status ring (Widgets mockup): a full accent circle while the last reading is up to date, two
// thirds in the flag color when it asks for another check, and in the critical color when it suggests a doctor.
internal data class StatusRing(val arc: Int, val color: (Palette) -> Long)

internal fun statusRing(statusKey: String?): StatusRing? =
    when (statusKey) {
        null -> null
        "regular" -> StatusRing(R.drawable.lumen_widget_ring) { it.accent }
        "see-doctor" -> StatusRing(R.drawable.lumen_widget_ring_part) { it.criticalText }
        else -> StatusRing(R.drawable.lumen_widget_ring_part) { it.flag }
    }

@Composable
private fun Ring(colors: WidgetColors, ring: StatusRing, size: Dp) {
    Box(modifier = GlanceModifier.size(size)) {
        Image(
            ImageProvider(R.drawable.lumen_widget_ring),
            contentDescription = null,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(colors.of { it.ringTrack }),
        )
        Image(
            ImageProvider(ring.arc),
            contentDescription = null,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(colors.of(ring.color)),
        )
    }
}

@Composable
private fun Card(colors: WidgetColors, scale: Float, padding: Int, modifier: GlanceModifier = GlanceModifier, content: @Composable () -> Unit) {
    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(colors.of { it.surface })
                .cornerRadius(CARD_RADIUS.dp)
                .padding((padding * scale).dp),
    ) { content() }
}

// The brand mark: the phone body, then the pulse line in the color behind it, which reads as the line cut out of
// the body in the brand SVG.
@Composable
internal fun Mark(body: ColorProvider, cut: ColorProvider, height: Dp, description: String?) {
    Box(modifier = GlanceModifier.size(height * MARK_ASPECT, height)) {
        Image(
            ImageProvider(R.drawable.lumen_brand_mark_body),
            contentDescription = description,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(body),
        )
        Image(
            ImageProvider(R.drawable.lumen_brand_mark_pulse),
            contentDescription = null,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(cut),
        )
    }
}

// Check now is filled; Full Scan is the tonal accent tint (Widgets mockup).
@Composable
internal fun Pill(
    colors: WidgetColors,
    label: String,
    action: Action,
    filled: Boolean,
    scale: Float,
    modifier: GlanceModifier,
    heightDp: Int,
) {
    val height = (heightDp * scale).dp
    Box(
        modifier =
            modifier
                .height(height)
                .background(if (filled) colors.of { it.buttonFill } else colors.of { it.tonalFill })
                .cornerRadius(height / 2)
                .clickable(action),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style =
                TextStyle(
                    color = if (filled) colors.of { it.onButtonFill } else colors.of { it.onTonalFill },
                    fontSize = (15 * scale).sp,
                    fontWeight = FontWeight.Medium,
                ),
            maxLines = 1,
        )
    }
}

// Widgets mockup, small: the status ring and the mark, the status, "Last check", and "Check now". Before the first
// reading a larger mark stands alone and the empty-state title and body take the status's and "Last check"'s places.
@Composable
private fun SmallBody(view: WidgetView, scale: Float, check: Action) {
    val title = view.status ?: view.emptyTitle
    val detail = if (view.statusKey == null) view.emptyBody else view.lastCheck
    val oneLine = title.length <= ONE_LINE_TITLE_CHARS
    val ring = statusRing(view.statusKey)
    val accent = view.colors.of { it.accent }
    val surface = view.colors.of { it.surface }
    // The whole small widget opens the check, as a tap on the iOS small widget does (widgetURL); a tap beside
    // the button did nothing on the API 37 emulator (2026-10-03).
    Card(view.colors, scale, padding = 14, modifier = GlanceModifier.clickable(check)) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            if (ring == null) {
                Mark(accent, surface, (28 * scale).dp, view.name)
            } else {
                Row(modifier = GlanceModifier.fillMaxWidth()) {
                    Ring(view.colors, ring, (36 * scale).dp)
                    Spacer(GlanceModifier.defaultWeight())
                    Mark(accent, surface, (20 * scale).dp, view.name)
                }
            }
            Spacer(GlanceModifier.defaultWeight())
            Text(
                title,
                style =
                    TextStyle(
                        color = view.colors.of { it.text },
                        // The mockup steps a two-line status down from 17 to 15 so it still fits above the button.
                        fontSize = ((if (oneLine) 17 else 15) * scale).sp,
                        fontWeight = FontWeight.Bold,
                    ),
                maxLines = 2,
            )
            if (detail != null && (scale >= ROOMY_SCALE || oneLine)) {
                Text(detail, style = TextStyle(color = view.colors.of { it.textDim }, fontSize = (12 * scale).sp), maxLines = 1)
            }
            Spacer(GlanceModifier.height((8 * scale).dp))
            Pill(view.colors, view.checkNow, check, true, scale, GlanceModifier.fillMaxWidth(), SMALL_PILL_HEIGHT)
        }
    }
}

// Widgets mockup, medium: the mark and name at the top left, the heart rate with "bpm" in the middle, the status
// and "Last check" at the bottom left, and "Check now" over "Full Scan" on the right. With values hidden or no heart
// rate the middle stays empty; before the first reading the empty-state title and body take the status's place.
@Composable
private fun MediumBody(view: WidgetView, scale: Float, width: Dp, check: Action, fullScan: Action) {
    val text = view.colors.of { it.text }
    val dim = view.colors.of { it.textDim }
    val title = view.status ?: view.emptyTitle
    val detail = if (view.statusKey == null) view.emptyBody else view.lastCheck
    Card(view.colors, scale, padding = 16) {
        Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Mark(view.colors.of { it.accent }, view.colors.of { it.surface }, (16 * scale).dp, null)
                    Spacer(GlanceModifier.width((6 * scale).dp))
                    Text(view.name, style = TextStyle(color = dim, fontSize = (13 * scale).sp), maxLines = 1)
                }
                Spacer(GlanceModifier.defaultWeight())
                if (view.statusKey != null && view.bpm != null) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            view.bpm,
                            style = TextStyle(color = text, fontSize = (40 * scale).sp, fontWeight = FontWeight.Bold),
                            maxLines = 1,
                        )
                        Spacer(GlanceModifier.width((4 * scale).dp))
                        // Lifts "bpm" from the bottom of the number's line box toward its baseline; Glance has no
                        // baseline alignment.
                        Text(
                            view.bpmUnit,
                            modifier = GlanceModifier.padding(bottom = (7 * scale).dp),
                            style = TextStyle(color = dim, fontSize = (16 * scale).sp, fontWeight = FontWeight.Medium),
                            maxLines = 1,
                        )
                    }
                    Spacer(GlanceModifier.defaultWeight())
                }
                Text(
                    title,
                    style = TextStyle(color = text, fontSize = (15 * scale).sp, fontWeight = FontWeight.Bold),
                    maxLines = 2,
                )
                detail?.let { Text(it, style = TextStyle(color = dim, fontSize = (13 * scale).sp), maxLines = 1) }
            }
            Spacer(GlanceModifier.width((16 * scale).dp))
            Column(
                modifier = GlanceModifier.width(width * BUTTON_COLUMN_SHARE).fillMaxHeight(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Pill(view.colors, view.checkNow, check, true, scale, GlanceModifier.fillMaxWidth(), MEDIUM_PILL_HEIGHT)
                Spacer(GlanceModifier.height((8 * scale).dp))
                Pill(view.colors, view.fullScan, fullScan, false, scale, GlanceModifier.fillMaxWidth(), MEDIUM_PILL_HEIGHT)
            }
        }
    }
}

@Composable
internal fun WidgetBody(view: WidgetView, medium: Boolean) {
    val context = LocalContext.current
    val size = LocalSize.current
    val check = actionStartActivity(linkIntent(context, CHECK_LINK))
    if (medium) {
        val fullScan = actionStartActivity(linkIntent(context, FULL_SCAN_LINK))
        MediumBody(view, scaleFor(size, MEDIUM_DESIGN), size.width, check, fullScan)
    } else {
        SmallBody(view, scaleFor(size, SMALL_DESIGN), check)
    }
}

private fun Context.argb(id: Int): Long = getColor(id).toLong() and 0xFFFFFFFFL

// The module's res copies of tokens.json's light and dark colors (kept equal by fallback-res.test.ts).
internal fun fallbackLight(context: Context) =
    Palette(
        surface = context.argb(R.color.lumen_widget_light_surface),
        text = context.argb(R.color.lumen_widget_light_text),
        textDim = context.argb(R.color.lumen_widget_light_text_dim),
        accent = context.argb(R.color.lumen_widget_light_accent),
        ringTrack = context.argb(R.color.lumen_widget_light_ring_track),
        buttonFill = context.argb(R.color.lumen_widget_light_button_fill),
        onButtonFill = context.argb(R.color.lumen_widget_light_on_button_fill),
        tonalFill = context.argb(R.color.lumen_widget_light_tonal_fill),
        onTonalFill = context.argb(R.color.lumen_widget_light_on_tonal_fill),
        flag = context.argb(R.color.lumen_widget_light_flag),
        criticalText = context.argb(R.color.lumen_widget_light_critical_text),
    )

internal fun fallbackDark(context: Context) =
    Palette(
        surface = context.argb(R.color.lumen_widget_dark_surface),
        text = context.argb(R.color.lumen_widget_dark_text),
        textDim = context.argb(R.color.lumen_widget_dark_text_dim),
        accent = context.argb(R.color.lumen_widget_dark_accent),
        ringTrack = context.argb(R.color.lumen_widget_dark_ring_track),
        buttonFill = context.argb(R.color.lumen_widget_dark_button_fill),
        onButtonFill = context.argb(R.color.lumen_widget_dark_on_button_fill),
        tonalFill = context.argb(R.color.lumen_widget_dark_tonal_fill),
        onTonalFill = context.argb(R.color.lumen_widget_dark_on_tonal_fill),
        flag = context.argb(R.color.lumen_widget_dark_flag),
        criticalText = context.argb(R.color.lumen_widget_dark_critical_text),
    )

// A widget placed before the app first publishes has no copy or palette yet, so it draws the empty state from
// the res copies of the tokens and the app's copy (kept equal by fallback-res.test.ts), in the phone's language
// and light or dark mode.
internal fun fallbackView(context: Context): WidgetView =
    WidgetView(
        name = context.applicationInfo.loadLabel(context.packageManager).toString(),
        statusKey = null,
        status = null,
        lastCheck = null,
        bpm = null,
        bpmUnit = "",
        checkNow = context.getString(R.string.lumen_widget_check_now),
        fullScan = context.getString(R.string.lumen_widget_full_scan),
        emptyTitle = context.getString(R.string.lumen_widget_empty_title),
        emptyBody = context.getString(R.string.lumen_widget_empty_body),
        theme = "system",
        light = fallbackLight(context),
        dark = fallbackDark(context),
    )

// The in-app gallery's sample reading (app/settings/widgets/index.tsx; the res picker strings hold the same).
private const val SAMPLE_BPM = 64
private const val SAMPLE_HOURS_AGO = 2L
private const val SAMPLE_HOUR_MS = 3_600_000L

// The picker preview Android 15+ generates from the real widget: the gallery's sample reading drawn with the
// published copy and palette, so the look follows any change to the widget. null before the app first publishes; the static previewLayout shows then.
internal fun sampleView(context: Context, nowMs: Long): WidgetView? {
    val displayJson = WidgetStore.display(context) ?: return null
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    val snapshot =
        JSONObject()
            .put("v", 1)
            .put("status", "regular")
            .put("lastReadingAt", format.format(Date(nowMs - SAMPLE_HOURS_AGO * SAMPLE_HOUR_MS)))
            .put("hrBpm", SAMPLE_BPM)
            .put("hideValues", false)
            .put("streakDays", 0)
            .put("theme", "system")
    return try {
        widgetView(snapshot.toString(), displayJson, nowMs)
    } catch (error: Exception) {
        // A copy stored by an older version can be unreadable after an update; the preview falls back to the
        // empty state until the next publish replaces it.
        Log.w("LumenWidgets", "Stored widget copy could not be read for the picker preview", error)
        null
    }
}

// Exact: the layout is drawn for the cell the launcher really gives, so it fills a large cell and still fits
// a 2x2 on a 360 dp phone.
class SmallWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val stored = WidgetStore.read(context, System.currentTimeMillis())
        provideContent {
            val view by remember { WidgetStore.views(context) }.collectAsState(initial = stored)
            WidgetBody(view ?: fallbackView(context), medium = false)
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val view = sampleView(context, System.currentTimeMillis()) ?: fallbackView(context)
        provideContent { WidgetBody(view, medium = false) }
    }
}

class MediumWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val stored = WidgetStore.read(context, System.currentTimeMillis())
        provideContent {
            val view by remember { WidgetStore.views(context) }.collectAsState(initial = stored)
            WidgetBody(view ?: fallbackView(context), medium = true)
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val view = sampleView(context, System.currentTimeMillis()) ?: fallbackView(context)
        provideContent { WidgetBody(view, medium = true) }
    }
}

class SmallWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SmallWidget()
}

class MediumWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MediumWidget()
}

suspend fun refreshWidgets(context: Context) {
    SmallWidget().updateAll(context)
    MediumWidget().updateAll(context)
    LockWidget().updateAll(context)
}

// Home screen only. The generated preview shows a sample heart rate and status, so it must never be offered for the
// lock screen (keyguard) or another surface, which setWidgetPreviews would include by default (WID-2).
internal val PREVIEW_CATEGORIES = intSetOf(AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN)

// Android 15+ shows a generated picker preview (providePreview) instead of previewLayout. The system limits how
// often an app may set them, so a refused call keeps the last preview until the copy changes again.
// https://developer.android.com/develop/ui/compose/glance/generated-previews
suspend fun refreshPickerPreviews(context: Context, displayJson: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    if (!WidgetStore.previewNeedsUpdate(context, displayJson)) return
    val manager = GlanceAppWidgetManager(context)
    val small = manager.setWidgetPreviews(SmallWidgetReceiver::class, PREVIEW_CATEGORIES)
    val medium = manager.setWidgetPreviews(MediumWidgetReceiver::class, PREVIEW_CATEGORIES)
    if (small == GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS &&
        medium == GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS
    ) {
        WidgetStore.markPreviewed(context, displayJson)
    } else {
        Log.w("LumenWidgets", "Picker preview update refused (results $small, $medium); retried on the next publish or app start")
    }
}

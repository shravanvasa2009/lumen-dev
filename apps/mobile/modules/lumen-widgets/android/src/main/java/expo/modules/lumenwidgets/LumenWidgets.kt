package expo.modules.lumenwidgets

import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.collection.intSetOf
import androidx.compose.runtime.Composable
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

// Mockup 32 draws the small widget at about 140 x 140 dp and the medium at 330 x 140 dp. Every size below is
// for that design and is multiplied by the scale for the cell the launcher actually gives.
private val SMALL_DESIGN = DpSize(140.dp, 140.dp)
private val MEDIUM_DESIGN = DpSize(330.dp, 140.dp)
// With the four-checks row (owner, 2026-10-03) the medium design is that much taller.
private val MEDIUM_WITH_CHECKS_DESIGN = DpSize(330.dp, 168.dp)

// The four checks in the order the app publishes their names (publish.ts): AFib, POTS, HRV, Diabetes.
private val CHECK_ICONS =
    listOf(
        R.drawable.lumen_check_afib,
        R.drawable.lumen_check_pots,
        R.drawable.lumen_check_hrv,
        R.drawable.lumen_check_diabetes,
    )
private const val DIABETES_CHECK = 3

// Below 0.75 the text gets too small to read; above 1.3 a very large cell would get oversized text. The
// layout's flexible spacers absorb what the clamp leaves.
private const val MIN_SCALE = 0.75f
private const val MAX_SCALE = 1.3f

// In the smallest cells a two-line status leaves no room for the line under it.
private const val ROOMY_SCALE = 0.9f
private const val ONE_LINE_TITLE_CHARS = 12

// The mark's body is 88 x 172 in the brand SVG.
private const val MARK_ASPECT = 88f / 172f

// The medium widget's button column, as a share of its width, and its button height (mockup 32). The small
// widget keeps 36 dp: at its 140 dp design size a 40 dp button would push the status line out.
private const val BUTTON_COLUMN_SHARE = 0.45f
private const val SMALL_PILL_HEIGHT = 36
private const val MEDIUM_PILL_HEIGHT = 40

private const val CARD_RADIUS = 24f
private const val BORDER = 1f

private fun scaleFor(size: DpSize, design: DpSize): Float =
    minOf(size.width / design.width, size.height / design.height).coerceIn(MIN_SCALE, MAX_SCALE)

// The app theme wins when the user picked one; "system" follows the phone's light or dark mode.
private fun WidgetView.color(pick: (Palette) -> Long): ColorProvider {
    val day = Color(pick(light))
    val night = Color(pick(dark))
    return when (theme) {
        "light" -> ColorProvider(day, day)
        "dark" -> ColorProvider(night, night)
        else -> ColorProvider(day, night)
    }
}

// The colors the app uses for each kind of result; mockup 32's dot is the up-to-date accent.
private fun WidgetView.statusColor(): ColorProvider? =
    when (statusKey) {
        null -> null
        "regular" -> color { it.accent }
        "see-doctor" -> color { it.criticalText }
        else -> color { it.flag }
    }

private fun joinLine(vararg parts: String?): String? = parts.filterNotNull().joinToString(" · ").ifEmpty { null }

// A 1 dp line-colored ring around the surface, like the app's cards. Glance has no border modifier, so the
// ring is the outer box's background showing through its padding.
@Composable
private fun Card(view: WidgetView, scale: Float, modifier: GlanceModifier = GlanceModifier, content: @Composable () -> Unit) {
    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(view.color { it.line })
                .cornerRadius(CARD_RADIUS.dp)
                .padding(BORDER.dp),
    ) {
        Box(
            modifier =
                GlanceModifier
                    .fillMaxSize()
                    .background(view.color { it.surface })
                    .cornerRadius((CARD_RADIUS - BORDER).dp)
                    .padding((14 * scale).dp),
        ) { content() }
    }
}

// The brand mark: the phone body in the accent color, then the pulse line in the surface color, which reads
// as the line cut out of the body in the brand SVG.
@Composable
private fun Mark(view: WidgetView, height: Dp, description: String?) {
    Box(modifier = GlanceModifier.size(height * MARK_ASPECT, height)) {
        Image(
            ImageProvider(R.drawable.lumen_brand_mark_body),
            contentDescription = description,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(view.color { it.accent }),
        )
        Image(
            ImageProvider(R.drawable.lumen_brand_mark_pulse),
            contentDescription = null,
            modifier = GlanceModifier.fillMaxSize(),
            colorFilter = ColorFilter.tint(view.color { it.surface }),
        )
    }
}

@Composable
private fun Pill(
    view: WidgetView,
    label: String,
    action: Action,
    filled: Boolean,
    scale: Float,
    modifier: GlanceModifier,
    heightDp: Int = SMALL_PILL_HEIGHT,
) {
    val height = (heightDp * scale).dp
    val caption =
        @Composable {
            Text(
                label,
                style =
                    TextStyle(
                        color = if (filled) view.color { it.onAccentFill } else view.color { it.text },
                        fontSize = (15 * scale).sp,
                        fontWeight = FontWeight.Medium,
                    ),
                maxLines = 1,
            )
        }
    if (filled) {
        Box(
            modifier = modifier.height(height).background(view.color { it.accentFill }).cornerRadius(height / 2).clickable(action),
            contentAlignment = Alignment.Center,
        ) { caption() }
    } else {
        // Outlined like the app's secondary buttons: a line2 ring around the card surface.
        Box(
            modifier =
                modifier
                    .height(height)
                    .background(view.color { it.line2 })
                    .cornerRadius(height / 2)
                    .padding(BORDER.dp)
                    .clickable(action),
        ) {
            Box(
                modifier = GlanceModifier.fillMaxSize().background(view.color { it.surface }).cornerRadius(height / 2 - BORDER.dp),
                contentAlignment = Alignment.Center,
            ) { caption() }
        }
    }
}

// Mockup 32 small: the mark and status dot, the status, "Last check", and "Check now". Before the first
// reading the empty-state title and body take the status's and "Last check"'s places.
@Composable
private fun SmallBody(view: WidgetView, scale: Float, check: Action) {
    val title = view.status ?: view.emptyTitle
    val detail = if (view.statusKey == null) view.emptyBody else view.lastCheck
    val detailFits = scale >= ROOMY_SCALE || title.length <= ONE_LINE_TITLE_CHARS
    // The whole small widget opens the check, as a tap on the iOS small widget does (widgetURL); a tap beside
    // the button did nothing on the API 37 emulator (2026-10-03).
    Card(view, scale, GlanceModifier.clickable(check)) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                Mark(view, (26 * scale).dp, view.name)
                // Four-checks proposal A: the small widget has room for the icons only.
                if (view.checks.isNotEmpty()) {
                    Row(modifier = GlanceModifier.padding(start = (8 * scale).dp, top = (7 * scale).dp)) {
                        CHECK_ICONS.forEachIndexed { index, icon ->
                            if (index > 0) Spacer(GlanceModifier.width((3 * scale).dp))
                            Image(
                                ImageProvider(icon),
                                contentDescription = null,
                                modifier = GlanceModifier.size((11 * scale).dp),
                                colorFilter = ColorFilter.tint(view.color { it.textDim }),
                            )
                        }
                    }
                }
                Spacer(GlanceModifier.defaultWeight())
                view.statusColor()?.let { dot ->
                    val size = (10 * scale).dp
                    Box(modifier = GlanceModifier.padding(top = (4 * scale).dp)) {
                        Box(modifier = GlanceModifier.size(size).background(dot).cornerRadius(size / 2)) {}
                    }
                }
            }
            Spacer(GlanceModifier.defaultWeight())
            Text(
                title,
                style = TextStyle(color = view.color { it.text }, fontSize = (18 * scale).sp, fontWeight = FontWeight.Bold),
                maxLines = 2,
            )
            if (detail != null && detailFits) {
                Text(detail, style = TextStyle(color = view.color { it.textDim }, fontSize = (13 * scale).sp), maxLines = 1)
            }
            Spacer(GlanceModifier.height((10 * scale).dp))
            Pill(view, view.checkNow, check, filled = true, scale = scale, modifier = GlanceModifier.fillMaxWidth())
        }
    }
}

// Four-checks proposal A (owner, 2026-10-03; ADR 0083): each check's icon and name, with the Diabetes evidence tag
// while it is Experimental. Home screen only; the lock screen never names a condition (WID-2).
// Each check is its own Row: a Glance Row holds at most 10 children (RemoteViews), and four checks with their spacers
// and the tag are 17; "Row container cannot have more than 10 elements" on the API 37 emulator, 2026-10-03.
@Composable
private fun CheckRow(view: WidgetView, scale: Float) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        view.checks.zip(CHECK_ICONS).forEachIndexed { index, (name, icon) ->
            if (index > 0) Spacer(GlanceModifier.width((8 * scale).dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    ImageProvider(icon),
                    contentDescription = null,
                    modifier = GlanceModifier.size((12 * scale).dp),
                    colorFilter = ColorFilter.tint(view.color { it.accent }),
                )
                Spacer(GlanceModifier.width((3 * scale).dp))
                Text(
                    name,
                    style = TextStyle(color = view.color { it.text }, fontSize = (12 * scale).sp, fontWeight = FontWeight.Medium),
                    maxLines = 1,
                )
                if (index == DIABETES_CHECK && view.diabetesTag != null) {
                    Spacer(GlanceModifier.width((4 * scale).dp))
                    Box(
                        modifier =
                            GlanceModifier
                                .background(view.color { it.badgeExperimentalBg })
                                .cornerRadius((8 * scale).dp)
                                .padding(horizontal = (5 * scale).dp, vertical = (1 * scale).dp),
                    ) {
                        Text(
                            view.diabetesTag,
                            style = TextStyle(color = view.color { it.badgeExperimentalFg }, fontSize = (9 * scale).sp),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

// Mockup 32 medium: the mark and name at the top left, the heart rate with "bpm" and "status · streak" at the
// bottom left, and "Check now" over "Full Scan" on the right. With values hidden or no heart rate, the status
// takes the number's place; before the first reading, the empty-state title and body do.
@Composable
private fun MediumBody(view: WidgetView, scale: Float, width: Dp, check: Action, fullScan: Action) {
    val text = view.color { it.text }
    val dim = view.color { it.textDim }
    Card(view, scale) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Mark(view, (24 * scale).dp, null)
                        Spacer(GlanceModifier.width((10 * scale).dp))
                        Text(view.name, style = TextStyle(color = dim, fontSize = (16 * scale).sp), maxLines = 1)
                    }
                    Spacer(GlanceModifier.defaultWeight())
                    if (view.statusKey != null && view.bpm != null) {
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                view.bpm,
                                style = TextStyle(color = text, fontSize = (40 * scale).sp, fontWeight = FontWeight.Bold),
                                maxLines = 1,
                            )
                            Spacer(GlanceModifier.width((6 * scale).dp))
                            // Lifts "bpm" from the bottom of the number's line box toward its baseline; Glance has no
                            // baseline alignment.
                            Text(
                                view.bpmUnit,
                                modifier = GlanceModifier.padding(bottom = (7 * scale).dp),
                                style = TextStyle(color = text, fontSize = (16 * scale).sp, fontWeight = FontWeight.Medium),
                                maxLines = 1,
                            )
                        }
                        joinLine(view.status, view.streak)?.let {
                            Text(it, style = TextStyle(color = dim, fontSize = (14 * scale).sp), maxLines = 1)
                        }
                    } else {
                        val title = view.status ?: view.emptyTitle
                        val detail = if (view.statusKey == null) view.emptyBody else joinLine(view.lastCheck, view.streak)
                        Text(
                            title,
                            style = TextStyle(color = text, fontSize = (22 * scale).sp, fontWeight = FontWeight.Bold),
                            maxLines = 2,
                        )
                        detail?.let { Text(it, style = TextStyle(color = dim, fontSize = (14 * scale).sp), maxLines = 1) }
                    }
                }
                Spacer(GlanceModifier.width((12 * scale).dp))
                Column(
                    modifier = GlanceModifier.width(width * BUTTON_COLUMN_SHARE).fillMaxHeight(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Pill(view, view.checkNow, check, true, scale, GlanceModifier.fillMaxWidth(), MEDIUM_PILL_HEIGHT)
                    Spacer(GlanceModifier.height((10 * scale).dp))
                    Pill(view, view.fullScan, fullScan, false, scale, GlanceModifier.fillMaxWidth(), MEDIUM_PILL_HEIGHT)
                }
            }
            if (view.checks.isNotEmpty()) {
                Spacer(GlanceModifier.height((6 * scale).dp))
                Box(modifier = GlanceModifier.fillMaxWidth().height(BORDER.dp).background(view.color { it.line })) {}
                Spacer(GlanceModifier.height((6 * scale).dp))
                CheckRow(view, scale)
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
        val design = if (view.checks.isEmpty()) MEDIUM_DESIGN else MEDIUM_WITH_CHECKS_DESIGN
        MediumBody(view, scaleFor(size, design), size.width, check, fullScan)
    } else {
        SmallBody(view, scaleFor(size, SMALL_DESIGN), check)
    }
}

private fun Context.argb(id: Int): Long = getColor(id).toLong() and 0xFFFFFFFFL

// A widget placed before the app first publishes has no copy or palette yet, so it draws the empty state from
// the module's res copies of tokens.json and the app's copy (kept equal by fallback-res.test.ts), in the
// phone's language and light or dark mode.
internal fun fallbackView(context: Context): WidgetView {
    val light =
        Palette(
            surface = context.argb(R.color.lumen_widget_light_surface),
            line = context.argb(R.color.lumen_widget_light_line),
            line2 = context.argb(R.color.lumen_widget_light_line2),
            text = context.argb(R.color.lumen_widget_light_text),
            textDim = context.argb(R.color.lumen_widget_light_text_dim),
            accent = context.argb(R.color.lumen_widget_light_accent),
            accentFill = context.argb(R.color.lumen_widget_light_accent_fill),
            onAccentFill = context.argb(R.color.lumen_widget_light_on_accent_fill),
            flag = context.argb(R.color.lumen_widget_light_flag),
            criticalText = context.argb(R.color.lumen_widget_light_critical_text),
            badgeExperimentalFg = context.argb(R.color.lumen_widget_light_badge_experimental_fg),
            badgeExperimentalBg = context.argb(R.color.lumen_widget_light_badge_experimental_bg),
        )
    val dark =
        Palette(
            surface = context.argb(R.color.lumen_widget_dark_surface),
            line = context.argb(R.color.lumen_widget_dark_line),
            line2 = context.argb(R.color.lumen_widget_dark_line2),
            text = context.argb(R.color.lumen_widget_dark_text),
            textDim = context.argb(R.color.lumen_widget_dark_text_dim),
            accent = context.argb(R.color.lumen_widget_dark_accent),
            accentFill = context.argb(R.color.lumen_widget_dark_accent_fill),
            onAccentFill = context.argb(R.color.lumen_widget_dark_on_accent_fill),
            flag = context.argb(R.color.lumen_widget_dark_flag),
            criticalText = context.argb(R.color.lumen_widget_dark_critical_text),
            badgeExperimentalFg = context.argb(R.color.lumen_widget_dark_badge_experimental_fg),
            badgeExperimentalBg = context.argb(R.color.lumen_widget_dark_badge_experimental_bg),
        )
    return WidgetView(
        name = context.applicationInfo.loadLabel(context.packageManager).toString(),
        statusKey = null,
        status = null,
        lastCheck = null,
        bpm = null,
        bpmUnit = "",
        streak = null,
        checkNow = context.getString(R.string.lumen_widget_check_now),
        fullScan = context.getString(R.string.lumen_widget_full_scan),
        checks = emptyList(),
        diabetesTag = null,
        emptyTitle = context.getString(R.string.lumen_widget_empty_title),
        emptyBody = context.getString(R.string.lumen_widget_empty_body),
        theme = "system",
        light = light,
        dark = dark,
    )
}

// The in-app gallery's sample reading (app/settings/widgets/index.tsx; the res picker strings hold the same).
private const val SAMPLE_BPM = 64
private const val SAMPLE_STREAK_DAYS = 5
private const val SAMPLE_HOURS_AGO = 2L
private const val SAMPLE_HOUR_MS = 3_600_000L

// The picker preview Android 15+ generates from the real widget: the gallery's sample reading drawn with the
// published copy, palette and checks, so the Diabetes tag follows the evidence label (EVID-1) and the look
// follows any change to the widget. null before the app first publishes; the static previewLayout shows then.
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
            .put("streakDays", SAMPLE_STREAK_DAYS)
            .put("theme", "system")
    return widgetView(snapshot.toString(), displayJson, nowMs)
}

// Exact: the layout is drawn for the cell the launcher really gives, so it fills a large cell and still fits
// a 2x2 on a 360 dp phone.
class SmallWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = WidgetStore.read(context, System.currentTimeMillis()) ?: fallbackView(context)
        provideContent { WidgetBody(view, medium = false) }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val view = sampleView(context, System.currentTimeMillis()) ?: fallbackView(context)
        provideContent { WidgetBody(view, medium = false) }
    }
}

class MediumWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = WidgetStore.read(context, System.currentTimeMillis()) ?: fallbackView(context)
        provideContent { WidgetBody(view, medium = true) }
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
}

// Home screen only. The generated preview names the four checks, so it must never be offered for the lock screen
// (keyguard) or another surface, which setWidgetPreviews would include by default (WID-2).
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
        Log.w("LumenWidgets", "Picker preview update refused (results $small, $medium); retried on the next publish")
    }
}

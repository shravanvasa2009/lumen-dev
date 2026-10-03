package expo.modules.lumenwidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
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
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

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

@Composable
private fun Pill(label: String, action: Action, fill: ColorProvider, content: ColorProvider) {
    Box(
        modifier = GlanceModifier.fillMaxWidth().background(fill).cornerRadius(20.dp).padding(vertical = 8.dp).clickable(action),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = TextStyle(color = content, fontSize = 14.sp, fontWeight = FontWeight.Medium))
    }
}

// Before the app first publishes there is no copy or palette, so the widget shows the app icon on Glance's
// widget surface, which follows the phone's light or dark mode, like the iOS no-data state. The app name is
// the icon's description for TalkBack, so no English is hard-coded. The whole widget still opens a check.
@Composable
private fun EmptyWidget(icon: ImageProvider, appName: String, open: Action) {
    Box(
        modifier = GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).cornerRadius(20.dp).clickable(open),
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = appName, modifier = GlanceModifier.size(40.dp))
    }
}

@Composable
internal fun WidgetBody(view: WidgetView?, medium: Boolean) {
    val context = LocalContext.current
    val check = actionStartActivity(linkIntent(context, CHECK_LINK))
    if (view == null) {
        val app = context.applicationInfo
        EmptyWidget(ImageProvider(app.icon), app.loadLabel(context.packageManager).toString(), check)
        return
    }
    val textColor = view.color { it.text }
    val dimColor = view.color { it.textDim }
    Column(modifier = GlanceModifier.fillMaxSize().background(view.color { it.surface }).cornerRadius(20.dp).padding(12.dp)) {
        Text(view.name, style = TextStyle(color = view.color { it.accentFill }, fontSize = 13.sp, fontWeight = FontWeight.Bold))
        if (medium && view.bpm != null) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(view.bpm, style = TextStyle(color = textColor, fontSize = 34.sp, fontWeight = FontWeight.Bold))
                Spacer(GlanceModifier.width(4.dp))
                Text(view.bpmUnit, style = TextStyle(color = dimColor, fontSize = 14.sp))
            }
        }
        view.status?.let { Text(it, style = TextStyle(color = textColor, fontSize = 15.sp, fontWeight = FontWeight.Medium)) }
        view.lastCheck?.let { Text(it, style = TextStyle(color = dimColor, fontSize = 12.sp)) }
        if (medium) {
            view.streak?.let { Text(it, style = TextStyle(color = dimColor, fontSize = 12.sp)) }
        }
        Spacer(GlanceModifier.defaultWeight())
        val fill = view.color { it.accentFill }
        val onFill = view.color { it.onAccentFill }
        if (medium) {
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                Box(modifier = GlanceModifier.defaultWeight()) { Pill(view.checkNow, check, fill, onFill) }
                Spacer(GlanceModifier.width(8.dp))
                Box(modifier = GlanceModifier.defaultWeight()) {
                    Pill(view.fullScan, actionStartActivity(linkIntent(context, FULL_SCAN_LINK)), view.color { it.line }, textColor)
                }
            }
        } else {
            Pill(view.checkNow, check, fill, onFill)
        }
    }
}

class SmallWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = WidgetStore.read(context, System.currentTimeMillis())
        provideContent { WidgetBody(view, medium = false) }
    }
}

class MediumWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = WidgetStore.read(context, System.currentTimeMillis())
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

package expo.modules.lumenwidgets

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private const val HOUR_MS = 3_600_000L

// ARGB colors from the app's design tokens (src/theme/tokens.json), sent by JS so they live in one place.
data class Palette(
    val surface: Long,
    val line: Long,
    val text: Long,
    val textDim: Long,
    val accentFill: Long,
    val onAccentFill: Long,
)

// What a widget draws. Every string comes from the JS display payload; null parts are left out.
data class WidgetView(
    val name: String,
    val status: String?,
    val lastCheck: String?,
    val bpm: String?,
    val bpmUnit: String,
    val streak: String?,
    val checkNow: String,
    val fullScan: String,
    val theme: String,
    val light: Palette,
    val dark: Palette,
)

// Appendix B writes UTC times to the second ("2026-10-04T07:41:58Z"). SimpleDateFormat, not java.time,
// because the app's minSdk is 24 and java.time needs 26 without desugaring.
internal fun parseUtcSeconds(text: String): Long {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.parse(text)?.time ?: throw IllegalArgumentException("Not a UTC time: $text")
}

// "#RRGGBB" only: the tokens the widget uses are opaque.
internal fun parseColor(hex: String): Long {
    require(Regex("^#[0-9A-Fa-f]{6}$").matches(hex)) { "Not a #RRGGBB color: $hex" }
    return 0xFF000000L or hex.substring(1).toLong(16)
}

private fun paletteOf(json: JSONObject) =
    Palette(
        surface = parseColor(json.getString("surface")),
        line = parseColor(json.getString("line")),
        text = parseColor(json.getString("text")),
        textDim = parseColor(json.getString("textDim")),
        accentFill = parseColor(json.getString("accentFill")),
        onAccentFill = parseColor(json.getString("onAccentFill")),
    )

// org.json's optString turns a JSON null into the text "null", so nulls are checked first.
private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

// Throws on a malformed payload, so publishSnapshot rejects instead of storing something the widget can't draw.
fun widgetView(snapshotJson: String, displayJson: String, nowMs: Long): WidgetView {
    val snapshot = JSONObject(snapshotJson)
    val display = JSONObject(displayJson)
    val status = snapshot.stringOrNull("status")
    val lastReadingAt = snapshot.stringOrNull("lastReadingAt")
    // The snapshot already drops hrBpm when values are hidden; checking hideValues too keeps a stale or
    // hand-edited snapshot from ever showing a number the user asked to hide.
    val hrBpm = if (snapshot.isNull("hrBpm") || snapshot.getBoolean("hideValues")) null else snapshot.getInt("hrBpm")
    val streakDays = snapshot.getInt("streakDays")
    val palettes = display.getJSONObject("palette")
    return WidgetView(
        name = display.getString("name"),
        status = status?.let { display.getJSONObject("status").getString(it) },
        lastCheck =
            lastReadingAt?.let {
                val hours = maxOf(0L, (nowMs - parseUtcSeconds(it)) / HOUR_MS)
                display.getString("lastCheck").replace("{{hours}}", hours.toString())
            },
        bpm = hrBpm?.toString(),
        bpmUnit = display.getString("bpm"),
        streak = if (streakDays > 0) display.getString("streak").replace("{{days}}", streakDays.toString()) else null,
        checkNow = display.getString("checkNow"),
        fullScan = display.getString("fullScan"),
        theme = snapshot.getString("theme"),
        light = paletteOf(palettes.getJSONObject("light")),
        dark = paletteOf(palettes.getJSONObject("dark")),
    )
}

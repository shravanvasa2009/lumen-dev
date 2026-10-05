package expo.modules.lumenwidgets

import android.content.Context
import android.util.Log

// Spec §9.6: Android widgets read the snapshot from SharedPreferences.
private const val PREFS = "lumen_widgets"
private const val SNAPSHOT_KEY = "snapshot"
private const val DISPLAY_KEY = "display"
private const val PREVIEWED_DISPLAY_KEY = "previewedDisplay"

// Appendix B snapshot for "no reading yet", drawn when the app has published its copy but no snapshot: the app
// publishes the copy at every launch, the snapshot only after a reading or a widget setting changes.
internal const val NO_READING_SNAPSHOT =
    """{"v":1,"updatedAt":"1970-01-01T00:00:00Z","lastReadingAt":null,"status":null,"hrBpm":null,""" +
        """"rhythmFlag":false,"diabetesFlag":false,"nextConfirmationAt":null,"streakDays":0,"hideValues":true,""" +
        """"theme":"system"}"""

object WidgetStore {
    // commit, not apply: the widgets re-read the store right after this returns.
    fun write(context: Context, snapshotJson: String, displayJson: String) {
        val saved =
            context
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(SNAPSHOT_KEY, snapshotJson)
                .putString(DISPLAY_KEY, displayJson)
                .commit()
        check(saved) { "Could not save the widget snapshot." }
    }

    fun writeDisplay(context: Context, displayJson: String) {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(DISPLAY_KEY, displayJson).commit()
        check(saved) { "Could not save the widget copy." }
    }

    // The published copy, palette and checks: what the picker's generated preview draws with a sample reading.
    fun display(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(DISPLAY_KEY, null)

    // Android rate-limits picker preview updates, so they're asked for only when the copy behind them changed or
    // the app was updated: an update drops the generated previews (seen on the API 37 emulator, 2026-10-04) while
    // this store survives it.
    fun previewNeedsUpdate(context: Context, displayJson: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREVIEWED_DISPLAY_KEY, null) !=
            previewKey(context, displayJson)

    fun markPreviewed(context: Context, displayJson: String) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(PREVIEWED_DISPLAY_KEY, previewKey(context, displayJson))
            .apply()
    }

    private fun previewKey(context: Context, displayJson: String): String {
        val updatedAt = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        return "$updatedAt|$displayJson"
    }

    // null until the app has published its copy once (a widget added before the app ever ran), or while the stored
    // payload is one this version can't read (written by an older app until its next publish).
    fun read(context: Context, nowMs: Long): WidgetView? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val displayJson = prefs.getString(DISPLAY_KEY, null) ?: return null
        val snapshotJson = prefs.getString(SNAPSHOT_KEY, null) ?: NO_READING_SNAPSHOT
        return try {
            widgetView(snapshotJson, displayJson, nowMs)
        } catch (error: Exception) {
            // The widget falls back to its empty state rather than the launcher's "can't load" box; the next
            // publish replaces the payload.
            Log.w("LumenWidgets", "Stored widget snapshot could not be read", error)
            null
        }
    }
}

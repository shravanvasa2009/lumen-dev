package expo.modules.lumenwidgets

import android.content.Context
import android.util.Log

// Spec §9.6: Android widgets read the snapshot from SharedPreferences.
private const val PREFS = "lumen_widgets"
private const val SNAPSHOT_KEY = "snapshot"
private const val DISPLAY_KEY = "display"

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

    // null until the app has published once (a widget added before the app ever ran), or while the stored
    // payload is one this version can't read (written by an older app until its next publish).
    fun read(context: Context, nowMs: Long): WidgetView? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val snapshotJson = prefs.getString(SNAPSHOT_KEY, null) ?: return null
        val displayJson = prefs.getString(DISPLAY_KEY, null) ?: return null
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

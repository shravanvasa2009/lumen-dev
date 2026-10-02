package expo.modules.lumenwidgets

import android.content.Context

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

    // null until the app has published once (a widget added before the app ever ran).
    fun read(context: Context, nowMs: Long): WidgetView? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val snapshotJson = prefs.getString(SNAPSHOT_KEY, null) ?: return null
        val displayJson = prefs.getString(DISPLAY_KEY, null) ?: return null
        return widgetView(snapshotJson, displayJson, nowMs)
    }
}

package expo.modules.lumenwidgets

import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class LumenWidgetsModule : Module() {
    private val context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() =
        ModuleDefinition {
            Name("LumenWidgets")

            // After an app update the picker is back to the static previewLayout until previews are set again, and
            // nothing may publish for days (publishes follow readings and settings), so start-up re-sets them.
            // The scope has no exception handler, so a failure here is reported, not left to crash the app's start.
            OnCreate {
                val reactContext = appContext.reactContext ?: return@OnCreate
                appContext.backgroundCoroutineScope.launch {
                    try {
                        val displayJson = WidgetStore.display(reactContext) ?: return@launch
                        refreshPickerPreviews(reactContext, displayJson)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        Log.w("LumenWidgets", "Picker previews could not be re-set at start-up", error)
                    }
                }
            }

            AsyncFunction("publishSnapshot") Coroutine { snapshotJson: String, displayJson: String ->
                // Parsed once here so a bad payload rejects the call instead of breaking the widgets later.
                widgetView(snapshotJson, displayJson, System.currentTimeMillis())
                WidgetStore.write(context, snapshotJson, displayJson)
                refreshWidgets(context)
                refreshPickerPreviews(context, displayJson)
            }

            // The copy alone, at every launch: a widget placed before any reading then shows the four checks and the
            // evidence tag instead of the fallback, and the picker gets its generated preview. The snapshot isn't sent,
            // so a launch never changes what the widget shows about readings.
            AsyncFunction("publishDisplay") Coroutine { displayJson: String ->
                widgetView(NO_READING_SNAPSHOT, displayJson, System.currentTimeMillis())
                WidgetStore.writeDisplay(context, displayJson)
                refreshWidgets(context)
                refreshPickerPreviews(context, displayJson)
            }

            // Start and update post the same notification on Android. They stay separate calls because iOS
            // requests a Live Activity on start and updates it afterwards (ADR 0005).
            AsyncFunction("startStandingTimer") { content: StandingTimerContent -> postStandingTimer(context, content) }

            AsyncFunction("updateStandingTimer") { content: StandingTimerContent -> postStandingTimer(context, content) }

            AsyncFunction("endStandingTimer") { endStandingTimer(context) }
        }
}

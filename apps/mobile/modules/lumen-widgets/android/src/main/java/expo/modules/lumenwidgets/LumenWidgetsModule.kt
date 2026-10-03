package expo.modules.lumenwidgets

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LumenWidgetsModule : Module() {
    private val context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() =
        ModuleDefinition {
            Name("LumenWidgets")

            AsyncFunction("publishSnapshot") Coroutine { snapshotJson: String, displayJson: String ->
                // Parsed once here so a bad payload rejects the call instead of breaking the widgets later.
                widgetView(snapshotJson, displayJson, System.currentTimeMillis())
                WidgetStore.write(context, snapshotJson, displayJson)
                refreshWidgets(context)
            }

            // Start and update post the same notification on Android. They stay separate calls because iOS
            // requests a Live Activity on start and updates it afterwards (ADR 0005).
            AsyncFunction("startStandingTimer") { content: StandingTimerContent -> postStandingTimer(context, content) }

            AsyncFunction("updateStandingTimer") { content: StandingTimerContent -> postStandingTimer(context, content) }

            AsyncFunction("endStandingTimer") { endStandingTimer(context) }
        }
}

package expo.modules.lumencapture

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The Appendix A functions and events are added by Track B (native-capture); until then the module only
// registers its name so the app links and Replay mode can run.
class LumenCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LumenCapture")
  }
}

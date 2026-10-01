import ExpoModulesCore

// The Appendix A functions and events are added by Track B (native-capture); until then the module only
// registers its name so the app links and Replay mode can run.
public class LumenCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LumenCapture")
  }
}

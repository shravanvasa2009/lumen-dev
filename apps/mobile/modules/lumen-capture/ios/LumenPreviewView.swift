import ExpoModulesCore

// The live fingertip view (ADR 0099): the running capture's preview, drawn natively. No props and no events; no
// frame or image reaches JS (CAP-3).
final class LumenPreviewView: ExpoView {
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // The preview layer is a sublayer, which UIView does not clip unless asked; screens round this view.
    clipsToBounds = true
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      LivePreview.attach(self)
    } else {
      LivePreview.detach(self)
    }
  }

  // React Native sizes this view; the preview layer fills it.
  override func layoutSubviews() {
    super.layoutSubviews()
    LivePreview.layout(self)
  }
}

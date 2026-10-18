import AVFoundation
import QuartzCore

// Connects the capture session to the one live view on screen (ADR 0099, the iOS side). Main thread only, like the
// views it serves.
//
// Why the layer is owned here, not by a view: it is given the session once, before any capture, and kept for the
// module's life, so a view coming or going only moves the layer between views and never reconfigures the session
// (which could reset the torch or restart AE). Each start()'s addInput forms the layer's connection to the new input,
// as in Apple's AVCam sample, which sets the preview session before configuring it; removeInputsAndOutputs() leaves
// the layer alone because a preview layer is not in session.outputs.
@MainActor
enum LivePreview {
  private static let previewLayer: AVCaptureVideoPreviewLayer = {
    let layer = AVCaptureVideoPreviewLayer()
    // The circle shows the middle of the fingertip; filling it beats letterboxing.
    layer.videoGravity = .resizeAspectFill
    return layer
  }()
  private static weak var holder: LumenPreviewView?

  // A JS reload creates a new module with a new session, so this replaces the session rather than keeping the first.
  static func connect(to session: AVCaptureSession) {
    previewLayer.session = session
  }

  // One view shows the layer at a time; the newest one wins, e.g. a screen pushed over another.
  static func attach(_ view: LumenPreviewView) {
    holder = view
    withoutAnimation {
      previewLayer.removeFromSuperlayer()
      view.layer.addSublayer(previewLayer)
      previewLayer.frame = view.bounds
    }
  }

  static func detach(_ view: LumenPreviewView) {
    guard holder === view else { return }
    holder = nil
    withoutAnimation { previewLayer.removeFromSuperlayer() }
  }

  static func layout(_ view: LumenPreviewView) {
    guard holder === view else { return }
    withoutAnimation { previewLayer.frame = view.bounds }
  }

  // A layer not backing a view animates frame and superlayer changes by default; the live view should just appear.
  private static func withoutAnimation(_ change: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    change()
    CATransaction.commit()
  }
}

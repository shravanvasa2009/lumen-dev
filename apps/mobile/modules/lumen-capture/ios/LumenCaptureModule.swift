import AVFoundation
import ExpoModulesCore

// CaptureConfig in LumenCapture.types.ts (Appendix A).
struct CaptureConfigRecord: Record {
  @Field var lensId: String?
  @Field var targetFps: Double?
  @Field var torchLevel: Double?
  @Field var exposureTarget: [Double]?
}

// The iOS side of LumenCapture.types.ts (Appendix A plus ADR 0013). Camera work runs on the capture session's own
// queue, so a slow camera call never blocks Expo's shared AsyncFunction queue.
public final class LumenCaptureModule: Module {
  private let capture = CaptureSession()

  public func definition() -> ModuleDefinition {
    Name("LumenCapture")

    Events("samples", "status", "lab")

    OnCreate {
      self.capture.emit = { [weak self] name, body in
        self?.sendEvent(name, body.mapValues { Optional($0) })
      }
    }

    AsyncFunction("getCapabilities") { () -> [String: Any] in
      LumenCaptureModule.capabilities()
    }.runOnQueue(capture.sessionQueue)

    AsyncFunction("getPermission") { () -> [String: Any] in
      LumenCaptureModule.cameraPermission()
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      AVCaptureDevice.requestAccess(for: .video) { _ in
        promise.resolve(LumenCaptureModule.cameraPermission())
      }
    }

    AsyncFunction("start") { (config: CaptureConfigRecord) in
      try self.capture.start(
        lensId: config.lensId,
        targetFps: config.targetFps,
        torchLevel: config.torchLevel,
        exposureTarget: config.exposureTarget
      )
    }.runOnQueue(capture.sessionQueue)

    AsyncFunction("stop") { () -> [String: Any] in
      self.capture.stop()
    }.runOnQueue(capture.sessionQueue)

    AsyncFunction("setTorch") { (level: Double) in
      try self.capture.setTorch(level)
    }.runOnQueue(capture.sessionQueue)

    AsyncFunction("lockExposure") {
      try self.capture.lockExposure()
    }.runOnQueue(capture.sessionQueue)
  }

  // Same shape and status rules as Expo's PermissionResponse (EXPermissionsService.m in expo-modules-core 57):
  // only an explicit denial stops the app from asking again. A restricted camera counts as denied.
  private static func cameraPermission() -> [String: Any] {
    let status: String
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: status = "granted"
    case .notDetermined: status = "undetermined"
    case .denied, .restricted: status = "denied"
    @unknown default: status = "denied"
    }
    return ["status": status, "expires": "never", "granted": status == "granted", "canAskAgain": status != "denied"]
  }

  private static func capabilities() -> [String: Any] {
    let lenses = CaptureSession.rearLenses()
    let torch = lenses.contains { CaptureSession.torchUsable($0) }
    // Locks are reported for the default (wide) lens, the one start() uses when no lens is named.
    let main = CaptureSession.defaultLens(lenses)
    let version = ProcessInfo.processInfo.operatingSystemVersion
    return [
      "platform": "ios",
      "modelId": machineIdentifier(),
      "osVersion": "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)",
      "rearLenses": lenses.map { lens -> [String: Any] in
        [
          "id": lens.uniqueID,
          "kind": CaptureSession.kind(of: lens),
          "maxFps": CaptureSession.maxFps(of: lens),
          "torchUsable": CaptureSession.torchUsable(lens),
        ]
      },
      // Every iOS torch takes a brightness level through setTorchModeOn(level:).
      "torch": ["available": torch, "levels": torch],
      "locks": [
        "exposure": main.map { $0.isExposureModeSupported(.custom) || $0.isExposureModeSupported(.locked) } ?? false,
        "whiteBalance": main?.isWhiteBalanceModeSupported(.locked) ?? false,
        "focus": main?.isFocusModeSupported(.locked) ?? false,
      ],
    ]
  }

  // Spec §9.2: the machine identifier from utsname, read on the phone and never typed in (spec §4.3).
  private static func machineIdentifier() -> String {
    var system = utsname()
    guard uname(&system) == 0 else { return "unknown" }
    return withUnsafeBytes(of: &system.machine) { raw in
      String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
    }
  }
}

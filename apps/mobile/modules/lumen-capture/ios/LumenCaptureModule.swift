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

    // A JS reload destroys the module; stopping here keeps the torch, timers and motion from running on.
    OnDestroy {
      let capture = self.capture
      capture.sessionQueue.async { capture.stopCapture() }
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
      do {
        try self.capture.start(
          lensId: config.lensId,
          targetFps: config.targetFps,
          torchLevel: config.torchLevel,
          exposureTarget: config.exposureTarget
        )
      } catch {
        throw captureError(wrapping: error)
      }
    }.runOnQueue(capture.sessionQueue)

    // ADR 0029 Addendum: the last samples batch reaches JS before stop() resolves. Events are scheduled on the JS
    // runtime at normal priority but promise results at immediate priority, so resolving at once could overtake that
    // batch; resolving from a normal-priority task queued after it keeps the order (expo-modules-jsi
    // JavaScriptRuntime.schedule, LegacyEventEmitterCompat.sendEvent, Promise.tryResolve).
    AsyncFunction("stop") { (promise: Promise) in
      do {
        let summary = try self.capture.stop()
        guard let runtime = try self.appContext?.runtime else {
          throw captureError("The JavaScript runtime is gone")
        }
        // resolve(Any?) takes a plain value; the generic resolve requires a `sending` one.
        runtime.schedule { promise.resolve(summary as Any?) }
      } catch {
        promise.reject(captureError(wrapping: error))
      }
    }.runOnQueue(capture.sessionQueue)

    AsyncFunction("setTorch") { (level: Double) in
      do {
        try self.capture.setTorch(level)
      } catch {
        throw captureError(wrapping: error)
      }
    }.runOnQueue(capture.sessionQueue)

    // ADR 0054 §4: iOS only; Android's Care map opens the user's maps app instead. Expo runs an async closure as
    // a concurrent function, so a slow search never holds the capture queue.
    AsyncFunction("searchNearbyCare") {
      (lat: Double, lon: Double, radiusM: Double, query: String) async throws -> [[String: Any]] in
      try await searchNearbyCare(lat: lat, lon: lon, radiusM: radiusM, query: query)
    }

    AsyncFunction("lockExposure") { (promise: Promise) in
      self.capture.lockExposure { error in
        if let error {
          promise.reject(captureError(wrapping: error))
        } else {
          promise.resolve()
        }
      }
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

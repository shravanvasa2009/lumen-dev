import AVFoundation
import CoreMotion
import ExpoModulesCore
import os

// The rear-camera pipeline (spec §9.2, §9.3). Setup, torch and locks run on `sessionQueue`, where the module runs
// its AsyncFunctions; frames, timers and motion run on `frameQueue`. Each frame is reduced to a few numbers there
// and never leaves this class (CAP-3). The capture queue never waits on the session queue, so neither can deadlock.
final class CaptureSession: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  // Physical rear lenses only (ADR 0029): virtual multi-lens devices would switch lenses under the finger.
  static let lensTypes: [AVCaptureDevice.DeviceType] = [
    .builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTelephotoCamera,
  ]
  // Spec §4.2 step 3: let auto-exposure settle for 1 s before locking.
  static let settleS = 1.0
  static let maxExposureSteps = 4
  // A custom exposure reaches the output a few frames after it is set; 0.2 s covers that at 30–240 fps.
  static let exposureLatencyS = 0.2
  static let freshFrames = 3
  // ADR 0029: user acceleration sampled at 50 Hz for motionRms.
  static let motionHz = 50.0

  let sessionQueue = DispatchQueue(label: "lumen.capture.session", qos: .userInitiated)
  var emit: ((String, [String: Any]) -> Void)?

  private let frameQueue = DispatchQueue(label: "lumen.capture.frames", qos: .userInteractive)
  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let motion = CMMotionManager()
  private let motionQueue = OperationQueue()
  private let log = Logger(subsystem: "lumen.capture", category: "capture")
  private var observers: [NSObjectProtocol] = []

  // Touched only on sessionQueue.
  private var device: AVCaptureDevice?
  private var running = false
  private var torchLevel = 1.0
  private var exposureTarget = defaultExposureTarget
  private var frameDurationS = 0.0
  private var startedNs: Int64 = 0

  // Touched only on frameQueue.
  private struct ActiveLens {
    let device: AVCaptureDevice
    let width: Int
    let height: Int
    let targetFps: Double
  }
  private let reducer = FrameReducer()
  private var counters = CaptureCounters(nominalIntervalNs: 1)
  private var lens: ActiveLens?
  private var capturing = false
  private var timers: [DispatchSourceTimer] = []

  override init() {
    super.init()
    // Motion updates share the frame queue, so the counters need no lock.
    motionQueue.underlyingQueue = frameQueue
    motionQueue.maxConcurrentOperationCount = 1
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) {
        [weak self] _ in
        self?.sessionQueue.async { self?.restoreTorch() }
      },
      center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) {
        [weak self] note in
        let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error
        self?.sessionQueue.async { self?.recover(from: error) }
      },
    ]
  }

  deinit {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  // MARK: Lenses

  static func rearLenses() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(deviceTypes: lensTypes, mediaType: .video, position: .back).devices
  }

  static func defaultLens(_ lenses: [AVCaptureDevice]) -> AVCaptureDevice? {
    lenses.first { $0.deviceType == .builtInWideAngleCamera } ?? lenses.first
  }

  static func kind(of lens: AVCaptureDevice) -> String {
    switch lens.deviceType {
    case .builtInWideAngleCamera: return "wide"
    case .builtInUltraWideCamera: return "ultrawide"
    case .builtInTelephotoCamera: return "tele"
    default: return "unknown"
    }
  }

  static func torchUsable(_ lens: AVCaptureDevice) -> Bool {
    lens.hasTorch && lens.isTorchModeSupported(.on)
  }

  static func maxFps(of lens: AVCaptureDevice) -> Double {
    formats(of: lens).map { $0.candidate.maxFps }.max() ?? 0
  }

  // 8-bit 4:2:0 formats only: the reducer reads 8-bit 32BGRA, and the 10-bit formats exist for HDR, which stays
  // off (spec §9.2).
  private static func formats(of lens: AVCaptureDevice) -> [(format: AVCaptureDevice.Format, candidate: FormatCandidate)] {
    lens.formats.compactMap { format -> (format: AVCaptureDevice.Format, candidate: FormatCandidate)? in
      let description = format.formatDescription
      let subtype = CMFormatDescriptionGetMediaSubType(description)
      guard subtype == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        || subtype == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
      else { return nil }
      let size = CMVideoFormatDescriptionGetDimensions(description)
      let maxFps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
      return (format, FormatCandidate(width: Int(size.width), height: Int(size.height), maxFps: maxFps))
    }
  }

  // MARK: Start and stop (sessionQueue)

  func start(lensId: String?, targetFps: Double?, torchLevel requestedTorch: Double?, exposureTarget bounds: [Double]?) throws {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw captureError("Camera permission is not granted")
    }
    guard let target = exposureWindow(bounds) else {
      throw captureError("exposureTarget must be two increasing values within 0..1")
    }
    let level = min(max(requestedTorch ?? 1, 0), 1)
    stopCapture()

    let lenses = Self.rearLenses()
    let chosen: AVCaptureDevice?
    if let lensId {
      chosen = lenses.first { $0.uniqueID == lensId }
    } else {
      chosen = Self.defaultLens(lenses)
    }
    guard let device = chosen else {
      throw captureError(lensId.map { "No rear lens with id \($0)" } ?? "This phone exposes no rear lens")
    }
    if level > 0 && !Self.torchUsable(device) {
      throw captureError("The \(Self.kind(of: device)) lens has no usable torch; start with torchLevel 0")
    }
    let options = Self.formats(of: device)
    let fps = resolveTargetFps(requested: targetFps, lensMaxFps: options.map { $0.candidate.maxFps }.max() ?? 0)
    guard let pick = chooseFormat(options.map { $0.candidate }, targetFps: fps) else {
      throw captureError("No 8-bit format on this lens reaches \(fps) fps")
    }
    let format = options[pick].format
    // Setting a frame duration outside every supported range raises an Objective-C exception, which Swift cannot
    // catch, so the range is checked first.
    guard
      let range = format.videoSupportedFrameRateRanges.first(where: {
        $0.minFrameRate <= fps && fps <= $0.maxFrameRate + 0.5
      })
    else {
      throw captureError("The chosen format has no frame-rate range containing \(fps) fps")
    }
    let frameDuration =
      fps >= range.maxFrameRate - 0.5 ? range.minFrameDuration : CMTime(value: 1, timescale: CMTimeScale(fps.rounded()))

    let input = try AVCaptureDeviceInput(device: device)
    try configure(device: device, input: input, format: format, frameDuration: frameDuration)

    let intervalNs = frameDuration.seconds * 1e9
    let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
    frameQueue.sync {
      counters = CaptureCounters(nominalIntervalNs: intervalNs)
      lens = ActiveLens(device: device, width: Int(size.width), height: Int(size.height), targetFps: 1e9 / intervalNs)
      capturing = true
    }
    startedNs = clockNowNs()
    session.startRunning()
    guard session.isRunning else {
      frameQueue.sync { capturing = false }
      detachSession()
      throw captureError("The camera did not start; another app may be using it")
    }
    self.device = device
    running = true
    torchLevel = level
    exposureTarget = target
    frameDurationS = frameDuration.seconds
    do {
      try applyTorch(device, level: level)
    } catch {
      stopCapture()
      throw error
    }
    startMotion()
    frameQueue.sync { startTimers() }
    // One Xcode console line per start answers device checks the Lab event cannot show, such as whether
    // startRunning() kept the chosen format and whether HDR and stabilization stayed off.
    let stabilization = output.connection(with: .video)?.activeVideoStabilizationMode.rawValue ?? -1
    let kind = Self.kind(of: device)
    let frameS = device.activeVideoMinFrameDuration.seconds
    let formatKept = device.activeFormat == format
    log.info(
      "Capture started: \(kind, privacy: .public) \(Int(size.width))x\(Int(size.height)), frame \(frameS) s, format kept \(formatKept)"
    )
    log.info(
      "HDR \(device.isVideoHDREnabled), stabilization mode \(stabilization), low-light boost \(device.isLowLightBoostEnabled), torch \(Double(device.torchLevel))"
    )
  }

  func stop() -> [String: Any] {
    let stoppedNs = clockNowNs()
    let lensId = device?.uniqueID
    stopCapture()
    let tally = frameQueue.sync { (frames: counters.frames, dropped: counters.dropped) }
    var summary: [String: Any] = [
      "startedNs": Double(startedNs == 0 ? stoppedNs : startedNs),
      "stoppedNs": Double(stoppedNs),
      "frames": tally.frames,
      "dropped": tally.dropped,
    ]
    if let lensId {
      summary["lensId"] = lensId
    }
    return summary
  }

  private func configure(
    device: AVCaptureDevice, input: AVCaptureDeviceInput, format: AVCaptureDevice.Format, frameDuration: CMTime
  ) throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    removeInputsAndOutputs()
    guard session.canAddInput(input) else { throw captureError("The camera input cannot be added") }
    session.addInput(input)
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    // Late frames are dropped rather than queued; DSP-1 then counts them from the timestamp gap.
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: frameQueue)
    guard session.canAddOutput(output) else { throw captureError("The frame output cannot be added") }
    session.addOutput(output)
    if let connection = output.connection(with: .video), connection.isVideoStabilizationSupported {
      connection.preferredVideoStabilizationMode = .off
    }

    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    // Setting activeFormat switches the session preset to inputPriority, so starting the session keeps it.
    device.activeFormat = format
    device.activeVideoMinFrameDuration = frameDuration
    device.activeVideoMaxFrameDuration = frameDuration
    if format.isVideoHDRSupported {
      device.automaticallyAdjustsVideoHDREnabled = false
      device.isVideoHDREnabled = false
    }
    // Low-light boost would change exposure behind the DSP-5 lock.
    if device.isLowLightBoostSupported {
      device.automaticallyEnablesLowLightBoostWhenAvailable = false
    }
    // Auto modes until lockExposure(), so the 1 s settle starts from the camera's own estimate.
    if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }
    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
      device.whiteBalanceMode = .continuousAutoWhiteBalance
    }
    if device.isFocusModeSupported(.continuousAutoFocus) {
      device.focusMode = .continuousAutoFocus
    }
  }

  private func stopCapture() {
    guard running else { return }
    running = false
    motion.stopDeviceMotionUpdates()
    if let device, device.torchMode != .off {
      do {
        try applyTorch(device, level: 0)
      } catch {
        log.error("Turning the torch off failed: \(error.localizedDescription, privacy: .public)")
      }
    }
    session.stopRunning()
    frameQueue.sync {
      timers.forEach { $0.cancel() }
      timers = []
      // Frames delivered before stopRunning() returned are already in the counters; send them so stop() loses none.
      emitBatch()
      capturing = false
      lens = nil
    }
    detachSession()
    device = nil
  }

  private func detachSession() {
    session.beginConfiguration()
    removeInputsAndOutputs()
    session.commitConfiguration()
  }

  private func removeInputsAndOutputs() {
    for input in session.inputs {
      session.removeInput(input)
    }
    for output in session.outputs {
      session.removeOutput(output)
    }
  }

  private func recover(from error: Error?) {
    log.error("Capture runtime error: \(String(describing: error), privacy: .public)")
    guard running, !session.isRunning else { return }
    session.startRunning()
    restoreTorch()
  }

  // MARK: Torch (sessionQueue)

  func setTorch(_ level: Double) throws {
    guard running, let device else { throw captureError("setTorch needs a running capture") }
    let clamped = min(max(level, 0), 1)
    if clamped > 0 && !Self.torchUsable(device) {
      throw captureError("The \(Self.kind(of: device)) lens has no usable torch")
    }
    try applyTorch(device, level: clamped)
    torchLevel = clamped
  }

  // The torch can go dark during an interruption (for example a phone call), so it is set again afterwards.
  private func restoreTorch() {
    guard running, let device else { return }
    do {
      try applyTorch(device, level: torchLevel)
    } catch {
      log.error("Restoring the torch failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func applyTorch(_ device: AVCaptureDevice, level: Double) throws {
    guard device.hasTorch else { return }
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    guard level > 0 else {
      if device.isTorchModeSupported(.off) {
        device.torchMode = .off
      }
      return
    }
    // setTorchModeOn(level:) throws when the level is above what the torch allows right now, for example when
    // the phone is hot; the brightest allowed level is then used instead.
    do {
      try device.setTorchModeOn(level: level >= 1 ? AVCaptureDevice.maxAvailableTorchLevel : Float(level))
    } catch {
      try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
    }
  }

  // MARK: Exposure, white balance and focus (sessionQueue)

  // DSP-5 as decided in ADR 0029: steer exposure until the red mean sits inside exposureTarget, then hold
  // exposure, white balance and focus (spec §4.2 step 3, ADR 0013).
  func lockExposure() throws {
    guard running, let device else { throw captureError("lockExposure needs a running capture") }
    let elapsedS = Double(clockNowNs() - startedNs) / 1e9
    if elapsedS < Self.settleS {
      Thread.sleep(forTimeInterval: Self.settleS - elapsedS)
    }
    if device.isExposureModeSupported(.custom) {
      try steerExposure(device)
    } else if device.isExposureModeSupported(.locked) {
      try configureDevice(device) { device.exposureMode = .locked }
    }
    try configureDevice(device) {
      if device.isWhiteBalanceModeSupported(.locked) {
        device.whiteBalanceMode = .locked
      }
      if device.isFocusModeSupported(.locked) {
        device.focusMode = .locked
      }
    }
    frameQueue.sync { counters.armOverexposureWatch() }
  }

  // A custom exposure is a held exposure: the camera keeps the set duration and ISO until changed.
  private func steerExposure(_ device: AVCaptureDevice) throws {
    var steps = 0
    var red = try freshRed()
    while !exposureTarget.contains(red) && steps < Self.maxExposureSteps {
      try scaleExposure(device, by: exposureFactor(red: red, target: exposureTarget))
      steps += 1
      red = try freshRed()
    }
    if device.exposureMode != .custom {
      try scaleExposure(device, by: 1)
    }
    log.info(
      "Exposure held after \(steps) steps: red \(red), duration \(device.exposureDuration.seconds) s, ISO \(Double(device.iso))"
    )
  }

  // DSP-5: red stayed above 0.95 after the lock, so lower the exposure one step and hold it (ADR 0029). Core sees
  // the change in exposureNs and marks the span as artifact.
  private func relieveOverexposure() {
    guard running, let device, device.isExposureModeSupported(.custom) else { return }
    let red = frameQueue.sync { counters.lastRed } ?? 1
    do {
      try scaleExposure(device, by: exposureFactor(red: red, target: exposureTarget))
    } catch {
      log.error("Lowering the exposure failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func scaleExposure(_ device: AVCaptureDevice, by factor: Double) throws {
    let format = device.activeFormat
    let limits = ExposureLimits(
      minDurationS: format.minExposureDuration.seconds,
      maxDurationS: min(format.maxExposureDuration.seconds, frameDurationS),
      minISO: Double(format.minISO),
      maxISO: Double(format.maxISO)
    )
    let current = ExposureSetting(durationS: device.exposureDuration.seconds, iso: Double(device.iso))
    let plan = planExposure(from: current, factor: factor, limits: limits)
    // Values outside the format's limits raise an Objective-C exception, so they are clamped again after rounding.
    var duration = CMTime(value: CMTimeValue(plan.durationS * 1e9), timescale: 1_000_000_000)
    if CMTimeCompare(duration, format.minExposureDuration) < 0 {
      duration = format.minExposureDuration
    }
    if CMTimeCompare(duration, format.maxExposureDuration) > 0 {
      duration = format.maxExposureDuration
    }
    let iso = min(max(Float(plan.iso), format.minISO), format.maxISO)
    try configureDevice(device) {
      device.setExposureModeCustom(duration: duration, iso: iso, completionHandler: nil)
    }
  }

  // The red mean of a frame taken after the latest exposure change.
  private func freshRed() throws -> Double {
    let before = frameQueue.sync { counters.frames }
    Thread.sleep(forTimeInterval: Self.exposureLatencyS)
    let deadline = Date().addingTimeInterval(1)
    while Date() < deadline {
      let (frames, red) = frameQueue.sync { (counters.frames, counters.lastRed) }
      if frames - before >= Self.freshFrames, let red {
        return red
      }
      Thread.sleep(forTimeInterval: 0.02)
    }
    throw captureError("No camera frames arrived while setting exposure")
  }

  private func configureDevice(_ device: AVCaptureDevice, _ change: () -> Void) throws {
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    change()
  }

  // MARK: Motion and timers

  // Simulators have no motion sensor; motionRms then stays 0.
  private func startMotion() {
    guard motion.isDeviceMotionAvailable else { return }
    motion.deviceMotionUpdateInterval = 1 / Self.motionHz
    motion.startDeviceMotionUpdates(to: motionQueue) { [weak self] update, _ in
      guard let self, let acceleration = update?.userAcceleration else { return }
      self.counters.addMotion(x: acceleration.x, y: acceleration.y, z: acceleration.z)
    }
  }

  // On frameQueue. Status keeps ticking without frames, so an interruption shows as fps 0 (ADR 0029).
  private func startTimers() {
    timers = [
      makeTimer(every: .milliseconds(100)) { [weak self] in self?.emitBatch() },
      makeTimer(every: .milliseconds(250)) { [weak self] in self?.emitStatus() },
    ]
    #if DEBUG
      timers.append(makeTimer(every: .seconds(1)) { [weak self] in self?.emitLab() })
    #endif
  }

  private func makeTimer(every interval: DispatchTimeInterval, _ tick: @escaping () -> Void) -> DispatchSourceTimer {
    let timer = DispatchSource.makeTimerSource(queue: frameQueue)
    timer.schedule(deadline: .now() + interval, repeating: interval)
    timer.setEventHandler { tick() }
    timer.resume()
    return timer
  }

  private func emitBatch() {
    if let batch = counters.drainBatch() {
      emit?("samples", batch)
    }
  }

  private func emitStatus() {
    emit?("status", counters.status(nowNs: clockNowNs(), thermal: ProcessInfo.processInfo.thermalState))
  }

  #if DEBUG
    // ADR 0013: development builds only; numbers about the camera, never frames.
    private func emitLab() {
      guard let lens else { return }
      let work = counters.drainWork()
      let device = lens.device
      emit?(
        "lab",
        [
          "lensId": device.uniqueID,
          "formatWidth": lens.width,
          "formatHeight": lens.height,
          "targetFps": lens.targetFps,
          "frameWorkMsMean": work.meanMs,
          "frameWorkMsMax": work.maxMs,
          "iso": Double(device.iso),
          "exposureNs": Double(Self.nanoseconds(device.exposureDuration)),
          "torchOn": device.torchMode == .on,
          "torchLevel": Double(device.torchLevel),
          "locked": [
            "exposure": device.exposureMode == .locked || device.exposureMode == .custom,
            "whiteBalance": device.whiteBalanceMode == .locked,
            "focus": device.focusMode == .locked,
          ],
        ]
      )
    }
  #endif

  // MARK: Frames (frameQueue)

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard capturing, let lens, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let workStart = DispatchTime.now().uptimeNanoseconds
    let tNs = Self.nanoseconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    guard CVPixelBufferLockBaseAddress(pixels, .readOnly) == kCVReturnSuccess else { return }
    let reduction = CVPixelBufferGetBaseAddress(pixels).flatMap { base in
      reducer.reduce(
        bgra: base,
        width: CVPixelBufferGetWidth(pixels),
        height: CVPixelBufferGetHeight(pixels),
        bytesPerRow: CVPixelBufferGetBytesPerRow(pixels)
      )
    }
    CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
    guard let reduction else { return }
    // Spec §9.2: each frame carries the exposure duration in force when it arrived.
    let exposureNs = Self.nanoseconds(lens.device.exposureDuration)
    let workMs = Double(DispatchTime.now().uptimeNanoseconds - workStart) / 1e6
    if counters.addFrame(tNs: tNs, reduction: reduction, exposureNs: exposureNs, workMs: workMs) {
      sessionQueue.async { [weak self] in self?.relieveOverexposure() }
    }
  }

  // MARK: Time

  // Apple: all capture output timestamps are on the session's synchronization clock, so start, stop and the fps
  // window read the same clock. The host clock stands in before the session has one.
  private func clockNowNs() -> Int64 {
    Self.nanoseconds(CMClockGetTime(session.synchronizationClock ?? CMClockGetHostTimeClock()))
  }

  private static func nanoseconds(_ time: CMTime) -> Int64 {
    CMTimeConvertScale(time, timescale: 1_000_000_000, method: .default).value
  }
}

func captureError(_ description: String) -> Exception {
  Exception(name: "LumenCaptureError", description: description, code: "ERR_LUMEN_CAPTURE")
}

// swift tools/showcase/record-iphone.swift ~/Desktop/iphone-setup.mov
// Records the screen of the iPhone plugged into this Mac by cable, the way QuickTime's "New Movie Recording" does,
// until Ctrl-C. The demo film's iPhone takes are recorded by the computer, like the A17's scrcpy recording. The
// first run asks to let Terminal use the camera: the iPhone's screen arrives as a camera device.
// Docs: https://developer.apple.com/documentation/avfoundation/avcapturemoviefileoutput
//       https://developer.apple.com/documentation/coremediaio (kCMIOHardwarePropertyAllowScreenCaptureDevices)
import AVFoundation
import CoreMediaIO
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2, arguments[1].hasSuffix(".mov") else {
  print("usage: swift tools/showcase/record-iphone.swift <output>.mov")
  exit(1)
}
let output = URL(fileURLWithPath: (arguments[1] as NSString).expandingTildeInPath)
if FileManager.default.fileExists(atPath: output.path) {
  print("\(output.path) already exists; pick a new name")
  exit(1)
}

// macOS lists a cabled iPhone's screen as a capture device only after this switch is on.
var allowAddress = CMIOObjectPropertyAddress(
  mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
  mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
  mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var allow: UInt32 = 1
let allowStatus = CMIOObjectSetPropertyData(
  CMIOObjectID(kCMIOObjectSystemObject), &allowAddress, 0, nil, UInt32(MemoryLayout<UInt32>.size), &allow)
guard allowStatus == 0 else {
  print("could not turn on iPhone screen capture (CoreMediaIO status \(allowStatus))")
  exit(1)
}

// A cabled iPhone's screen is a muxed (picture and sound) device; Mac cameras are video-only, so this finds no
// camera. AVCaptureDevice.devices(for:) is deprecated but still lists these devices.
func iPhoneScreen() -> AVCaptureDevice? {
  let devices = AVCaptureDevice.devices(for: .muxed)
  return devices.first { $0.modelID == "iOS Device" } ?? devices.first
}

// The device shows up a moment after the switch; the run loop has to turn for the notification to arrive.
var device: AVCaptureDevice?
let deadline = Date().addingTimeInterval(15)
while device == nil && Date() < deadline {
  RunLoop.current.run(until: Date().addingTimeInterval(0.5))
  device = iPhoneScreen()
}
guard let device else {
  print("no iPhone screen found: plug the iPhone in by cable, unlock it, tap Trust, and close QuickTime")
  exit(1)
}

let session = AVCaptureSession()
do {
  let input = try AVCaptureDeviceInput(device: device)
  guard session.canAddInput(input) else {
    print("the iPhone screen (\(device.localizedName)) is busy: close QuickTime and try again")
    exit(1)
  }
  session.addInput(input)
} catch {
  print("could not open \(device.localizedName): \(error.localizedDescription)")
  exit(1)
}
let movie = AVCaptureMovieFileOutput()
guard session.canAddOutput(movie) else {
  print("cannot record a movie from \(device.localizedName)")
  exit(1)
}
session.addOutput(movie)
session.startRunning()

final class Finish: NSObject, AVCaptureFileOutputRecordingDelegate {
  func fileOutput(
    _ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection],
    error: Error?
  ) {
    // A stop on request also reports an error, with AVErrorRecordingSuccessfullyFinishedKey set to true.
    let finished =
      error == nil
      || ((error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false)
    print(finished ? "saved \(url.path)" : "recording failed: \(error!.localizedDescription)")
    exit(finished ? 0 : 1)
  }
}
let finish = Finish()
movie.startRecording(to: output, recordingDelegate: finish)
print("recording \(device.localizedName) to \(output.path); press Ctrl-C to stop")

signal(SIGINT, SIG_IGN)
let stop = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
stop.setEventHandler {
  print("stopping…")
  movie.stopRecording()
}
stop.resume()
dispatchMain()

// swift-tools-version:5.9
// Runs the tests for the AVFoundation-free files in Pure/ with `swift test` from this folder on a Mac. The app
// build uses LumenCapture.podspec, which excludes this file and Tests/.
import PackageDescription

let package = Package(
  name: "LumenCapturePure",
  platforms: [.iOS(.v16), .macOS(.v13)],
  targets: [
    .target(name: "LumenCapturePure", path: "Pure"),
    .testTarget(name: "LumenCapturePureTests", dependencies: ["LumenCapturePure"], path: "Tests"),
  ]
)

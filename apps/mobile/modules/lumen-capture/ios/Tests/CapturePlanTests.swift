import XCTest

@testable import LumenCapturePure

final class CapturePlanTests: XCTestCase {
  // ADR 0029: with no requested rate, the lens maximum capped at 120 fps (keeps a 100 ms batch near the ~2 KB of
  // spec §9.3); a requested rate is honoured up to the lens maximum and 240 fps (spec §9.2).
  func testTargetFpsDefaultsToTheLensMaximumCappedAt120() {
    XCTAssertEqual(resolveTargetFps(requested: nil, lensMaxFps: 240), 120)
    XCTAssertEqual(resolveTargetFps(requested: nil, lensMaxFps: 60), 60)
    XCTAssertEqual(resolveTargetFps(requested: 0, lensMaxFps: 240), 120)
    XCTAssertEqual(resolveTargetFps(requested: 0, lensMaxFps: 60), 60)
  }

  func testRequestedFpsIsHonouredUpTo240() {
    XCTAssertEqual(resolveTargetFps(requested: 240, lensMaxFps: 240), 240)
    XCTAssertEqual(resolveTargetFps(requested: 240, lensMaxFps: 480), 240)
    XCTAssertEqual(resolveTargetFps(requested: 30, lensMaxFps: 240), 30)
    XCTAssertEqual(resolveTargetFps(requested: 120, lensMaxFps: 60), 60)
  }

  func testFormatChoiceIsTheSmallestThatReachesTheRate() {
    let formats = [
      FormatCandidate(width: 1920, height: 1080, maxFps: 60),
      FormatCandidate(width: 640, height: 480, maxFps: 30),
      FormatCandidate(width: 1280, height: 720, maxFps: 240),
      FormatCandidate(width: 960, height: 540, maxFps: 60),
      FormatCandidate(width: 192, height: 144, maxFps: 30),
    ]
    XCTAssertEqual(chooseFormat(formats, targetFps: 30), 4)
    XCTAssertEqual(chooseFormat(formats, targetFps: 60), 3)
    XCTAssertEqual(chooseFormat(formats, targetFps: 240), 2)
    XCTAssertNil(chooseFormat(formats, targetFps: 300))
    XCTAssertNil(chooseFormat([], targetFps: 30))
  }

  func testFormatChoiceTreats59Point94AsSixty() {
    let formats = [FormatCandidate(width: 1280, height: 720, maxFps: 59.94)]
    XCTAssertEqual(chooseFormat(formats, targetFps: 60), 0)
  }

  func testExposureWindowDefaultsAndRejectsBadBounds() {
    XCTAssertEqual(exposureWindow(nil), 0.55...0.80)
    XCTAssertEqual(exposureWindow([0.5, 0.7]), 0.5...0.7)
    XCTAssertNil(exposureWindow([0.7, 0.5]))
    XCTAssertNil(exposureWindow([0.5]))
    XCTAssertNil(exposureWindow([-0.1, 0.5]))
    XCTAssertNil(exposureWindow([0.5, 1.2]))
  }

  func testExposureFactorAimsAtTheMiddleOfTheWindow() {
    let window = 0.55...0.80
    XCTAssertEqual(exposureFactor(red: 0.675, target: window), 1, accuracy: 1e-12)
    XCTAssertEqual(exposureFactor(red: 0.3, target: window), pow(0.675 / 0.3, 2.2), accuracy: 1e-12)
    XCTAssertEqual(exposureFactor(red: 1.0, target: window), pow(0.675, 2.2), accuracy: 1e-12)
    XCTAssertEqual(exposureFactor(red: 0.01, target: window), 8)
    XCTAssertEqual(exposureFactor(red: 0, target: window), 8)
  }

  func testExposurePlanPrefersLongerDurationOverHigherIso() {
    let limits = ExposureLimits(minDurationS: 1e-5, maxDurationS: 1.0 / 60, minISO: 50, maxISO: 3000)
    let current = ExposureSetting(durationS: 0.004, iso: 100)

    let brighter = planExposure(from: current, factor: 2, limits: limits)
    XCTAssertEqual(brighter.durationS, 0.016, accuracy: 1e-12)
    XCTAssertEqual(brighter.iso, 50, accuracy: 1e-9)

    let muchBrighter = planExposure(from: current, factor: 10, limits: limits)
    XCTAssertEqual(muchBrighter.durationS, 1.0 / 60, accuracy: 1e-12)
    XCTAssertEqual(muchBrighter.iso, 240, accuracy: 1e-9)

    let darker = planExposure(from: current, factor: 0.01, limits: limits)
    XCTAssertEqual(darker.durationS, 8e-5, accuracy: 1e-12)
    XCTAssertEqual(darker.iso, 50, accuracy: 1e-9)

    let floor = planExposure(from: current, factor: 1e-6, limits: limits)
    XCTAssertEqual(floor.durationS, 1e-5, accuracy: 1e-15)
    XCTAssertEqual(floor.iso, 50, accuracy: 1e-9)

    let ceiling = planExposure(from: current, factor: 1e6, limits: limits)
    XCTAssertEqual(ceiling.durationS, 1.0 / 60, accuracy: 1e-12)
    XCTAssertEqual(ceiling.iso, 3000, accuracy: 1e-9)
  }
}

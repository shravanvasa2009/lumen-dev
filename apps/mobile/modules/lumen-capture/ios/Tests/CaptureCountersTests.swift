import XCTest

@testable import LumenCapturePure

final class CaptureCountersTests: XCTestCase {
  private let interval60 = 1e9 / 60
  private let covered = FrameReduction(r: 0.6, g: 0.1, b: 0.1, spatialStdR: 0.05, clipFrac: 0.01)
  private let bright = FrameReduction(r: 0.99, g: 0.1, b: 0.1, spatialStdR: 0.01, clipFrac: 0.9)

  private func ns(_ frameIndex: Int, fps: Double = 60) -> Int64 {
    Int64((Double(frameIndex) * 1e9 / fps).rounded())
  }

  @discardableResult
  private func add(_ counters: inout CaptureCounters, at tNs: Int64, _ reduction: FrameReduction? = nil, workMs: Double = 0)
    -> Bool
  {
    counters.addFrame(tNs: tNs, reduction: reduction ?? covered, exposureNs: 8_000_000, workMs: workMs)
  }

  // DSP-1 as set in ADR 0029: a gap above 1.5 median intervals counts round(gap / median) − 1 dropped frames. The
  // median covers the intervals of the last 1 s; the nominal interval stands in until 5 of them exist.
  func testSteadyFramesDropNothing() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in 0..<120 { add(&counters, at: ns(index)) }
    XCTAssertEqual(counters.frames, 120)
    XCTAssertEqual(counters.dropped, 0)
    XCTAssertEqual(counters.droppedFrac, 0)
  }

  func testGapOfThreeIntervalsCountsTwoDropped() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in [0, 1, 2, 5] { add(&counters, at: ns(index)) }
    XCTAssertEqual(counters.frames, 4)
    XCTAssertEqual(counters.dropped, 2)
    XCTAssertEqual(counters.droppedFrac, 2.0 / 6, accuracy: 1e-12)
  }

  func testGapJustUnderAndOverTheThreshold() {
    var under = CaptureCounters(nominalIntervalNs: interval60)
    add(&under, at: 0)
    add(&under, at: Int64(1.4 * interval60))
    XCTAssertEqual(under.dropped, 0)

    var over = CaptureCounters(nominalIntervalNs: interval60)
    add(&over, at: 0)
    add(&over, at: Int64(1.6 * interval60))
    XCTAssertEqual(over.dropped, 1)
  }

  func testMedianIntervalReplacesTheNominalOnceFiveIntervalsExist() {
    // Nominal 60 fps but the camera delivers 30 fps: each of the first 5 intervals is 2 nominal intervals (1
    // dropped each); from the 6th on, the median is the real 33 ms interval and nothing more is dropped.
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in 0..<60 { add(&counters, at: ns(index, fps: 30)) }
    XCTAssertEqual(counters.dropped, 5)
  }

  func testGapIsJudgedByTheMedianOfTheLastSecond() {
    var counters = CaptureCounters(nominalIntervalNs: 1e9 / 30)
    for index in 0..<30 { add(&counters, at: ns(index, fps: 30)) }
    add(&counters, at: ns(29, fps: 30) + 3 * 33_333_333)
    XCTAssertEqual(counters.dropped, 2)
  }

  func testNominalIntervalReturnsWhenTheLastSecondHoldsTooFewIntervals() {
    // After a 2 s stall the last second holds no intervals, so the 2 s gap is judged against the nominal 16.7 ms
    // (119 dropped), not the 33 ms median from before the stall (59).
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in 0..<10 { add(&counters, at: ns(index, fps: 30)) }
    XCTAssertEqual(counters.dropped, 5)
    add(&counters, at: ns(9, fps: 30) + 2_000_000_000)
    XCTAssertEqual(counters.dropped, 5 + 119)
  }

  func testMedianIntervalIsNominalUntilFiveIntervalsThenMeasured() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    XCTAssertEqual(counters.medianIntervalNs, interval60)
    for index in 0..<5 { add(&counters, at: ns(index, fps: 30)) }
    XCTAssertEqual(counters.medianIntervalNs, interval60)
    add(&counters, at: ns(5, fps: 30))
    XCTAssertEqual(counters.medianIntervalNs, 1e9 / 30, accuracy: 1)
  }

  // ADR 0029: the lockExposure waits use the median of the last 5 intervals however old, so they also scale below
  // 5 fps, where the 1 s window never holds 5 intervals (4 fps here).
  func testLastFiveMedianIgnoresAgeAndIsNominalUntilFiveIntervals() {
    var counters = CaptureCounters(nominalIntervalNs: 1e9 / 30)
    for index in 0..<5 { add(&counters, at: ns(index, fps: 4)) }
    XCTAssertEqual(counters.lastFiveMedianIntervalNs, 1e9 / 30)
    add(&counters, at: ns(5, fps: 4))
    XCTAssertEqual(counters.lastFiveMedianIntervalNs, 2.5e8, accuracy: 1)
    XCTAssertEqual(counters.medianIntervalNs, 1e9 / 30)
    XCTAssertEqual(lockWaitS(medianIntervalNs: counters.lastFiveMedianIntervalNs), 2.5, accuracy: 1e-6)
  }

  func testFpsCountsFramesInTheLastSecondAndFallsToZeroWhenFramesStop() {
    var counters = CaptureCounters(nominalIntervalNs: 1e9 / 30)
    for index in 0..<60 { add(&counters, at: ns(index, fps: 30)) }
    let last = ns(59, fps: 30)
    XCTAssertEqual(counters.status(nowNs: last + 1_000_000, thermal: .nominal)["fps"] as? Int, 30)
    XCTAssertEqual(counters.status(nowNs: last + 2_000_000_000, thermal: .nominal)["fps"] as? Int, 0)
  }

  func testBatchHoldsEveryFrameSinceTheLastDrainThenEmpties() throws {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in 0..<5 { add(&counters, at: ns(index)) }
    let batch = try XCTUnwrap(counters.drainBatch())
    let samples = try XCTUnwrap(batch["samples"] as? [[String: Double]])
    let stats = try XCTUnwrap(batch["stats"] as? [[String: Double]])
    XCTAssertEqual(samples.count, 5)
    XCTAssertEqual(stats.count, 5)
    XCTAssertEqual(samples[1], ["tNs": Double(ns(1)), "r": 0.6, "g": 0.1, "b": 0.1])
    XCTAssertEqual(
      stats[1], ["tNs": Double(ns(1)), "spatialStdR": 0.05, "clipFrac": 0.01, "exposureNs": 8_000_000])
    XCTAssertNil(counters.drainBatch())
  }

  func testContactHintUsesOnlyFramesSinceThePreviousStatus() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    add(&counters, at: 0)
    XCTAssertEqual(counters.status(nowNs: 1, thermal: .nominal)["fingerCovered"] as? Bool, true)
    XCTAssertEqual(counters.status(nowNs: 2, thermal: .nominal)["fingerCovered"] as? Bool, false)
  }

  func testStatusCarriesDroppedFractionMotionAndThermal() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    for index in [0, 1, 2, 5] { add(&counters, at: ns(index)) }
    for _ in 0..<10 { counters.addMotion(x: 0.3, y: 0.4, z: 0) }
    let status = counters.status(nowNs: ns(5), thermal: .serious)
    XCTAssertEqual(status["droppedFrac"] as? Double ?? -1, 2.0 / 6, accuracy: 1e-12)
    XCTAssertEqual(status["motionRms"] as? Double ?? -1, 0.5, accuracy: 1e-12)
    XCTAssertEqual(status["thermal"] as? String, "serious")
  }

  func testMotionRmsCoversOnlyTheLast50Samples() {
    var window = MotionWindow()
    XCTAssertEqual(window.rms, 0)
    for _ in 0..<50 { window.add(x: 0.3, y: 0.4, z: 0) }
    XCTAssertEqual(window.rms, 0.5, accuracy: 1e-12)
    for _ in 0..<50 { window.add(x: 0, y: 0, z: 0) }
    XCTAssertEqual(window.rms, 0)
  }

  func testThermalStatesMapToContractNames() {
    XCTAssertEqual(thermalName(.nominal), "nominal")
    XCTAssertEqual(thermalName(.fair), "fair")
    XCTAssertEqual(thermalName(.serious), "serious")
    XCTAssertEqual(thermalName(.critical), "critical")
  }

  func testWorkTimeIsSummarisedAndReset() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    add(&counters, at: ns(0), workMs: 1)
    add(&counters, at: ns(1), workMs: 3)
    let work = counters.drainWork()
    XCTAssertEqual(work.meanMs, 2, accuracy: 1e-12)
    XCTAssertEqual(work.maxMs, 3)
    let empty = counters.drainWork()
    XCTAssertEqual(empty.meanMs, 0)
    XCTAssertEqual(empty.maxMs, 0)
  }

  // DSP-5 as set in ADR 0029: after the lock, red above 0.95 for 0.5 s asks once for lower exposure.
  func testOverexposureWatchFiresOnceAfterHalfASecondWhenArmed() {
    var unarmed = CaptureCounters(nominalIntervalNs: interval60)
    let unarmedFires = (0..<120).filter { add(&unarmed, at: ns($0), bright) }
    XCTAssertEqual(unarmedFires, [])

    var armed = CaptureCounters(nominalIntervalNs: interval60)
    armed.armOverexposureWatch()
    let fires = (0..<120).filter { add(&armed, at: ns($0), bright) }
    XCTAssertEqual(fires, [30])
  }

  func testOverexposureWatchRestartsAfterANormalFrame() {
    var counters = CaptureCounters(nominalIntervalNs: interval60)
    counters.armOverexposureWatch()
    let fires = (0..<120).filter { index in
      add(&counters, at: ns(index), index == 20 ? covered : bright)
    }
    XCTAssertEqual(fires, [51])
  }
}

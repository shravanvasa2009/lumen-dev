import XCTest

@testable import LumenCapturePure

// Synthetic 100 × 50 BGRA frames. The reducer keeps the central 60%, so x 20..<80 and y 10..<40, and samples every
// 4th pixel: 15 columns (x = 20, 24, …, 76) by 8 rows (y = 10, 14, …, 38), 120 pixels.
final class FrameReducerTests: XCTestCase {
  private let width = 100
  private let height = 50

  private func frame(bytesPerRow: Int? = nil, pixel: (Int, Int) -> (b: UInt8, g: UInt8, r: UInt8)) -> [UInt8] {
    let stride = bytesPerRow ?? 4 * width
    // Row padding is filled with 255 so a reducer that read it would be caught.
    var bytes = [UInt8](repeating: 255, count: stride * height)
    for y in 0..<height {
      for x in 0..<width {
        let color = pixel(x, y)
        let offset = y * stride + 4 * x
        bytes[offset] = color.b
        bytes[offset + 1] = color.g
        bytes[offset + 2] = color.r
        bytes[offset + 3] = 255
      }
    }
    return bytes
  }

  private func reduce(_ bytes: [UInt8], bytesPerRow: Int? = nil) throws -> FrameReduction {
    let reduction = bytes.withUnsafeBytes { raw in
      raw.baseAddress.flatMap { base in
        FrameReducer().reduce(bgra: base, width: width, height: height, bytesPerRow: bytesPerRow ?? 4 * width)
      }
    }
    return try XCTUnwrap(reduction)
  }

  private func isSampled(_ x: Int, _ y: Int) -> Bool {
    (20..<80).contains(x) && (10..<40).contains(y) && (x - 20) % 4 == 0 && (y - 10) % 4 == 0
  }

  func testUniformFrameGivesItsColorWithNoSpreadOrClipping() throws {
    let reduction = try reduce(frame { _, _ in (10, 20, 200) })
    XCTAssertEqual(reduction.r, 200.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.g, 20.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.b, 10.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.spatialStdR, 0, accuracy: 1e-6)
    XCTAssertEqual(reduction.clipFrac, 0)
  }

  func testOnlySampledPixelsOfTheCentralRegionCount() throws {
    let reduction = try reduce(frame { x, y in self.isSampled(x, y) ? (0, 0, 180) : (255, 255, 0) })
    XCTAssertEqual(reduction.r, 180.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.g, 0)
    XCTAssertEqual(reduction.b, 0)
  }

  func testSpatialStdOfRedAcrossSampledRows() throws {
    // Sampled rows alternate red 100 and 200: mean 150, population standard deviation 50.
    let reduction = try reduce(frame { _, y in ((y - 10) / 4) % 2 == 0 ? (0, 0, 100) : (0, 0, 200) })
    XCTAssertEqual(reduction.r, 150.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.spatialStdR, 50.0 / 255, accuracy: 1e-6)
  }

  func testClipFractionCountsRedAtOrAbove250() throws {
    // One sampled column of 15 is at 250 (clipped), one at 249 (not clipped).
    let reduction = try reduce(frame { x, _ in x == 20 ? (0, 0, 250) : x == 24 ? (0, 0, 249) : (0, 0, 200) })
    XCTAssertEqual(reduction.clipFrac, 1.0 / 15, accuracy: 1e-12)
  }

  func testRowPaddingIsIgnored() throws {
    let padded = 4 * width + 64
    let reduction = try reduce(frame(bytesPerRow: padded) { _, _ in (10, 20, 200) }, bytesPerRow: padded)
    XCTAssertEqual(reduction.r, 200.0 / 255, accuracy: 1e-9)
    XCTAssertEqual(reduction.clipFrac, 0)
  }

  func testEmptyFrameGivesNoReduction() {
    let byte: [UInt8] = [0]
    let reduction = byte.withUnsafeBytes { raw in
      raw.baseAddress.flatMap { FrameReducer().reduce(bgra: $0, width: 0, height: 0, bytesPerRow: 0) }
    }
    XCTAssertNil(reduction)
  }

  // DSP-4 initial values as core applies them: R/(G+B) ≥ 2.0, R ≥ 0.30, spatial std ≤ 0.10; clipping is not
  // a contact test.
  func testContactHintFollowsDsp4() {
    let covered = FrameReduction(r: 0.6, g: 0.1, b: 0.1, spatialStdR: 0.05, clipFrac: 0.01)
    XCTAssertTrue(covered.coversLens)
    XCTAssertTrue(FrameReduction(r: 0.30, g: 0.075, b: 0.075, spatialStdR: 0.10, clipFrac: 0.05).coversLens)
    XCTAssertFalse(FrameReduction(r: 0.6, g: 0.2, b: 0.2, spatialStdR: 0.05, clipFrac: 0.01).coversLens)
    XCTAssertFalse(FrameReduction(r: 0.29, g: 0.05, b: 0.05, spatialStdR: 0.05, clipFrac: 0.01).coversLens)
    XCTAssertFalse(FrameReduction(r: 0.6, g: 0.1, b: 0.1, spatialStdR: 0.11, clipFrac: 0.01).coversLens)
    XCTAssertTrue(FrameReduction(r: 0.6, g: 0.1, b: 0.1, spatialStdR: 0.05, clipFrac: 0.06).coversLens)
    XCTAssertFalse(FrameReduction(r: 1.2, g: 0.1, b: 0.1, spatialStdR: 0.05, clipFrac: 0.01).coversLens)
    XCTAssertFalse(FrameReduction(r: 0.6, g: 0.1, b: 0.1, spatialStdR: .nan, clipFrac: 0.01).coversLens)
  }
}

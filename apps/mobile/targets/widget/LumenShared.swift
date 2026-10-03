import ActivityKit
import Foundation

// Compiled twice: into the app's lumen-widgets module (modules/lumen-widgets/ios) and into this widget
// extension. The two copies must stay identical (modules/lumen-widgets/shared-swift.test.ts): ActivityKit
// pairs the app's Live Activity with the extension's UI through the attributes type, and both sides read the
// snapshot with the same decoder. Same pattern as expo-live-activity's LiveActivityAttributes.

// The standing-test live timer (LIVE-1). Every string comes from lockscreen.json, so the lock screen and the
// Dynamic Island never show a value or a condition name (WID-2).
struct StandingActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var text: String
    var step: String
    var tapHint: String
    // From the update that set it to the moment the next reading opens; nil while a reading is due.
    var countdown: ClosedRange<Date>?
  }
}

// Appendix B widget snapshot, v1: only the fields the widgets draw. Times are UTC ISO 8601 to the second.
struct WidgetSnapshot: Decodable {
  let v: Int
  let lastReadingAt: Date?
  let status: String?
  let hrBpm: Int?
  let nextConfirmationAt: Date?
  let streakDays: Int
  let hideValues: Bool
  let theme: String
}

// The token colors the widgets draw with, as "#RRGGBB" (src/theme/tokens.json, sent by widgetDisplay).
struct WidgetPalette: Decodable {
  let surface: String
  let line: String
  let text: String
  let textDim: String
  let accentFill: String
  let onAccentFill: String
}

struct WidgetPalettes: Decodable {
  let light: WidgetPalette
  let dark: WidgetPalette
}

// widgetDisplay in src/widgets/publish.ts: the widgets' copy in the app's language, so no Swift file holds a
// user-facing string. Lock-screen families use only name, status, inline and nextCheck (WID-2).
struct WidgetDisplay: Decodable {
  let language: String
  let name: String
  let status: [String: String]
  let inline: [String: String]
  let nextCheck: String
  let lastCheck: String
  let bpm: String
  let streak: String
  let checkNow: String
  let fullScan: String
  let palette: WidgetPalettes
}

enum WidgetPayloadError: LocalizedError {
  case unknownVersion(Int)
  case unknownStatus(String)
  case badColor(String)
  case noAppGroup

  var errorDescription: String? {
    switch self {
    case .unknownVersion(let version): return "Widget snapshot version \(version) is not 1."
    case .unknownStatus(let status): return "The widget copy has no line for status \(status)."
    case .badColor(let hex): return "Not a #RRGGBB color: \(hex)."
    case .noAppGroup: return "LumenAppGroup is missing from Info.plist or is not a usable App Group."
    }
  }
}

// "#RRGGBB" only: the tokens the widgets use are opaque.
func rgbValue(_ hex: String) throws -> UInt32 {
  let digits = hex.dropFirst()
  guard hex.hasPrefix("#"), digits.count == 6, digits.allSatisfy(\.isHexDigit), let value = UInt32(digits, radix: 16)
  else { throw WidgetPayloadError.badColor(hex) }
  return value
}

struct WidgetContent {
  let snapshot: WidgetSnapshot
  let display: WidgetDisplay

  // Throws on a payload the widgets could not draw, so publishSnapshot rejects instead of storing it.
  init(snapshotJson: String, displayJson: String) throws {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    snapshot = try decoder.decode(WidgetSnapshot.self, from: Data(snapshotJson.utf8))
    display = try decoder.decode(WidgetDisplay.self, from: Data(displayJson.utf8))
    guard snapshot.v == 1 else { throw WidgetPayloadError.unknownVersion(snapshot.v) }
    if let status = snapshot.status, display.status[status] == nil || display.inline[status] == nil {
      throw WidgetPayloadError.unknownStatus(status)
    }
    for palette in [display.palette.light, display.palette.dark] {
      for hex in [palette.surface, palette.line, palette.text, palette.textDim, palette.accentFill, palette.onAccentFill] {
        _ = try rgbValue(hex)
      }
    }
  }
}

enum WidgetStore {
  private static let snapshotKey = "snapshot"
  private static let displayKey = "display"

  // The app bundle, also when running inside the widget extension, which sits in the app's PlugIns folder.
  static func appBundle() -> Bundle {
    let url = Bundle.main.bundleURL
    guard url.pathExtension == "appex" else { return Bundle.main }
    return Bundle(url: url.deletingLastPathComponent().deletingLastPathComponent()) ?? Bundle.main
  }

  // The lumen-widgets config plugin writes the App Group ID (group.<bundle ID>) into the app's Info.plist, so
  // a personal-team build with its own bundle ID needs no code change (ADR 0005).
  private static func sharedDefaults() throws -> UserDefaults {
    guard let group = appBundle().object(forInfoDictionaryKey: "LumenAppGroup") as? String,
      let defaults = UserDefaults(suiteName: group)
    else { throw WidgetPayloadError.noAppGroup }
    return defaults
  }

  static func write(snapshotJson: String, displayJson: String) throws {
    let defaults = try sharedDefaults()
    defaults.set(snapshotJson, forKey: snapshotKey)
    defaults.set(displayJson, forKey: displayKey)
  }

  // nil until the app has published once (a widget added before the app ever ran).
  static func read() throws -> WidgetContent? {
    let defaults = try sharedDefaults()
    guard let snapshotJson = defaults.string(forKey: snapshotKey),
      let displayJson = defaults.string(forKey: displayKey)
    else { return nil }
    return try WidgetContent(snapshotJson: snapshotJson, displayJson: displayJson)
  }
}

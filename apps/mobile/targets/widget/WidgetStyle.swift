import SwiftUI
import WidgetKit

// Spec §9.6: widgets never measure; every tap opens the app through one of these links, which
// app/+native-intent.tsx maps to screens. The same three links as the Android widgets (Links.kt).
enum LumenLink {
  static let check = URL(string: "lumen://check")!
  static let fullScan = URL(string: "lumen://check?mode=full")!
  static let standing = URL(string: "lumen://standing")!
}

// The app's own name, so a rename reaches the widget gallery and the empty inline widget (spec §2).
let appDisplayName = WidgetStore.appBundle().object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? ""

// The colors one widget draws with. The app theme wins when the user picked one; "system" follows the phone.
struct WidgetColors {
  let surface: Color
  let line: Color
  let line2: Color
  let text: Color
  let textDim: Color
  let accent: Color
  let accentFill: Color
  let onAccentFill: Color
  let flag: Color
  let criticalText: Color
  let badgeExperimentalFg: Color
  let badgeExperimentalBg: Color

  init(_ palettes: WidgetPalettes, theme: String, scheme: ColorScheme) {
    let dark = theme == "dark" || (theme != "light" && scheme == .dark)
    let palette = dark ? palettes.dark : palettes.light
    surface = Color(hex: palette.surface)
    line = Color(hex: palette.line)
    line2 = Color(hex: palette.line2)
    text = Color(hex: palette.text)
    textDim = Color(hex: palette.textDim)
    accent = Color(hex: palette.accent)
    accentFill = Color(hex: palette.accentFill)
    onAccentFill = Color(hex: palette.onAccentFill)
    flag = Color(hex: palette.flag)
    criticalText = Color(hex: palette.criticalText)
    // An older app publishes no badge colors; the tag it can't send isn't drawn then anyway.
    badgeExperimentalFg = Color(hex: palette.badgeExperimentalFg ?? palette.textDim)
    badgeExperimentalBg = Color(hex: palette.badgeExperimentalBg ?? palette.line)
  }
}

extension Color {
  // WidgetContent already checked every color when it was published, so a bad one cannot reach here; black
  // keeps the type non-optional.
  init(hex: String) {
    let value = (try? rgbValue(hex)) ?? 0
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}

extension View {
  // iOS 17 draws a widget's background from containerBackground and adds the margins itself; iOS 16 needs both
  // by hand, and the lock-screen families draw no background.
  // https://developer.apple.com/documentation/swiftui/view/containerbackground(_:for:)
  @ViewBuilder
  func widgetBackground(_ color: Color, padded: Bool) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(color, for: .widget)
    } else if padded {
      padding().background(color)
    } else {
      background(color)
    }
  }
}

// The Lumen mark, generated from assets/brand/notification-icon-96.png by expo-target.config.json, drawn in
// the surrounding color so it follows the lock screen's tint.
struct LumenMark: View {
  var body: some View {
    Image("lumenMark").resizable().renderingMode(.template).scaledToFit()
  }
}

import SwiftUI

// What a widget draws before the app first publishes: the widget gallery's preview and a widget added before
// the first reading. Copied from src/i18n/lockscreen.json, the app's i18n files and src/theme/tokens.json, in
// the phone's language; modules/lumen-widgets/ios-fallback.test.ts fails if they differ. Android keeps the
// same copies in its res folder (fallback-res.test.ts).
struct FallbackCopy {
  let description: String
  let emptyTitle: String
  let emptyBody: String
  let checkNow: String
  let fullScan: String
}

private let englishCopy = FallbackCopy(
  description: "Your last check, with Check now and Full Scan",
  emptyTitle: "No checks yet",
  emptyBody: "Takes 90 seconds",
  checkNow: "Check now",
  fullScan: "Full Scan"
)

private let spanishCopy = FallbackCopy(
  description: "Tu última revisión, con Revisar ahora y Escaneo completo",
  emptyTitle: "Sin revisiones aún",
  emptyBody: "Toma 90 segundos",
  checkNow: "Revisar ahora",
  fullScan: "Escaneo completo"
)

// The app ships English and Spanish only (spec §12); any other language reads English, as in the app.
let fallbackCopy = Locale.current.language.languageCode?.identifier == "es" ? spanishCopy : englishCopy

// The buttonFill role's token and its text (PALETTE_TOKENS in publish.ts) are the same in light and dark, so one
// value serves both.
let fallbackButtonFill = Color(hex: "#0B7A70")
let fallbackOnButtonFill = Color(hex: "#FFFFFF")

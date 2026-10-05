// The one place a decimal number becomes text: the decimal mark follows the app language (es writes 0,7).
// Hermes in React Native 0.86 is built with Intl (HERMES_ENABLE_INTL in react-native's hermes-engine
// build.gradle.kts), https://hermesengine.dev/docs/intl/. Stored values and the CSV export stay unformatted.
export function formatNumber(
  value: number,
  language: string,
  maximumFractionDigits = 1,
  minimumFractionDigits = 0,
  useGrouping = true,
): string {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits,
    minimumFractionDigits,
    useGrouping,
  }).format(value);
}

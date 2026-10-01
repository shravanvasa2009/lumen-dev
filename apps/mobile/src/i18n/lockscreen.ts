import strings from './lockscreen.json';

type LockscreenLocale = keyof typeof strings;
type LockscreenStrings = (typeof strings)['en'];

// Lock-screen and notification copy is visible without unlocking, so it carries no health details (WID-2).
// Accepts a bare language or a regional tag (es-MX reads as es); unsupported languages fall back to English.
// An own-key check, so names like "toString" from Object.prototype never count as a language.
export function lockscreenStrings(languageTag: string): LockscreenStrings {
  const language = languageTag.split('-')[0]?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(strings, language)
    ? strings[language as LockscreenLocale]
    : strings.en;
}

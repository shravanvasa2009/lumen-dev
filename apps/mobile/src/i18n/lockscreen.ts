import strings from './lockscreen.json';

type LockscreenLocale = keyof typeof strings;
type LockscreenStrings = (typeof strings)['en'];

// Lock-screen and notification copy is visible without unlocking, so it carries no health details (WID-2).
// Unsupported languages fall back to English.
export function lockscreenStrings(language: string): LockscreenStrings {
  return language in strings ? strings[language as LockscreenLocale] : strings.en;
}

import type { ClockTime } from './localTime';

// The date is arbitrary: only the hour and minute are formatted, in the person's language.
export function formatClock({ hour, minute }: ClockTime, languageTag: string): string {
  return new Intl.DateTimeFormat(languageTag, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(2000, 0, 1, hour, minute),
  );
}

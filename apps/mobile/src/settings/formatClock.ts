import type { ClockTime } from '@/notifications/localTime';

// The date is arbitrary: only the hour and minute are formatted, in the person's language. The day period
// (AM or PM) can be left out where the screen shows neighbouring times compactly.
export function formatClock({ hour, minute }: ClockTime, languageTag: string, withPeriod = true): string {
  return new Intl.DateTimeFormat(languageTag, { hour: 'numeric', minute: '2-digit' })
    .formatToParts(new Date(2000, 0, 1, hour, minute))
    .filter((part) => withPeriod || part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
}

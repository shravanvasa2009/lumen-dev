// Wall-clock math in a named time zone through Intl, so reminders keep their local time across daylight
// saving changes without a time-zone library.
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type ClockTime = { hour: number; minute: number };
export type LocalDate = { year: number; month: number; day: number };
type LocalParts = LocalDate & ClockTime & { second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

export function localPartsAt(instantMs: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    // Some engines write midnight as 24 when hour12 is false.
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  };
}

function wallClockMs({ year, month, day, hour, minute, second }: LocalParts): number {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

// Whole seconds: Intl drops milliseconds, and every zone in use today has a whole-minute offset.
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const wholeSecondMs = Math.floor(instantMs / 1000) * 1000;
  return Math.round((wallClockMs(localPartsAt(instantMs, timeZone)) - wholeSecondMs) / MINUTE_MS);
}

export function addDays({ year, month, day }: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// No zone changes its offset twice within two days, so the offsets a day either side cover both readings
// of a wall time. A time repeated when clocks go back resolves to the first one; a time skipped when
// clocks go forward resolves to the same distance past the jump (2:30 becomes 3:30).
export function instantAt(date: LocalDate, clock: ClockTime, timeZone: string): number {
  const { year, month, day } = date;
  const wallMs = wallClockMs({ year, month, day, hour: clock.hour, minute: clock.minute, second: 0 });
  const offsetBefore = offsetMinutesAt(wallMs - DAY_MS, timeZone);
  const offsetAfter = offsetMinutesAt(wallMs + DAY_MS, timeZone);
  const matches = [offsetBefore, offsetAfter]
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((instantMs) => wallClockMs({ ...localPartsAt(instantMs, timeZone), second: 0 }) === wallMs);
  return matches.length > 0 ? Math.min(...matches) : wallMs - offsetBefore * MINUTE_MS;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function localDateKey({ year, month, day }: LocalDate): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Appendix B writes fire times as local time with the zone's offset, for example 2026-10-04T11:45:00-05:00.
export function isoWithOffset(instantMs: number, timeZone: string): string {
  const parts = localPartsAt(instantMs, timeZone);
  const offset = offsetMinutesAt(instantMs, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const offsetText = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${localDateKey(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${offsetText}`;
}

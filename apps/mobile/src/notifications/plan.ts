import { LYING_MS, STANDING_READING_MINUTES } from '../standing/protocol';
import { addDays, type ClockTime, instantAt, isoWithOffset, localDateKey, localPartsAt } from './localTime';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// §9.6: at most 3 a day and nothing more than 30 days ahead.
const DAILY_CAP = 3;
const HORIZON_DAYS = 30;

// "Later the same day": long enough for a passing cause such as coffee or a workout to wear off.
const SAME_DAY_CONFIRMATION_MS = 4 * HOUR_MS;
const DOCTOR_FOLLOWUP_DAYS = 7;
// The spec leaves the re-test interval open; 30 days is recorded in ADR 0005.
const RETEST_DAYS = 30;

export type NotificationType = 'daily' | 'confirmation' | 'doctor-followup' | 'standing' | 'retest';

export type NotificationPrefs = {
  enabled: Readonly<Record<NotificationType, boolean>>;
  dailyTime: ClockTime;
  quietHours: { start: ClockTime; end: ClockTime };
};

type ReadingRef = { readingId: string; takenAt: number };

export type NotificationTriggers = {
  // The latest result that asks for a confirmation reading; null once it is confirmed.
  confirmationFor: ReadingRef | null;
  // The latest result that suggested a doctor visit.
  doctorFollowupFor: ReadingRef | null;
  // Set while a standing test runs; null once it finishes or is stopped.
  standingStartedAt: number | null;
  lastPhoneCheckAt: number | null;
};

export type PlanRequest = {
  prefs: NotificationPrefs;
  triggers: NotificationTriggers;
  now: number;
  timeZone: string;
};

// Appendix B notification schedule entry.
export type PlannedNotification = {
  id: string;
  type: NotificationType;
  fireAt: string;
  route: string;
  createdFor: string;
};

// The phone re-test lives on the "Your phone" screen, next to the rating it refreshes.
const ROUTES: Readonly<Record<NotificationType, string>> = {
  daily: 'lumen://check',
  confirmation: 'lumen://check?mode=full',
  'doctor-followup': '/follow-up',
  standing: 'lumen://standing',
  retest: '/settings/phone',
};

// Appendix B ids start "confirm-"; the scheduler recognises Lumen's own requests by these prefixes.
export const ID_PREFIXES: Readonly<Record<NotificationType, string>> = {
  daily: 'daily',
  confirmation: 'confirm',
  'doctor-followup': 'doctor',
  standing: 'standing',
  retest: 'retest',
};

// When more than 3 land on one day, the ones that matter most for the person's care are kept.
const CAP_PRIORITY: readonly NotificationType[] = ['doctor-followup', 'confirmation', 'retest', 'daily'];

type Candidate = { type: NotificationType; atMs: number; createdFor: string };

const minutesOf = ({ hour, minute }: ClockTime) => hour * 60 + minute;

function inQuietHours(clock: ClockTime, { start, end }: NotificationPrefs['quietHours']): boolean {
  const at = minutesOf(clock);
  const from = minutesOf(start);
  const until = minutesOf(end);
  if (from === until) return false;
  return from < until ? at >= from && at < until : at >= from || at < until;
}

function afterQuietHours(
  atMs: number,
  quietHours: NotificationPrefs['quietHours'],
  timeZone: string,
): number {
  const parts = localPartsAt(atMs, timeZone);
  if (!inQuietHours(parts, quietHours)) return atMs;
  const endsTomorrow =
    minutesOf(quietHours.start) > minutesOf(quietHours.end) &&
    minutesOf(parts) >= minutesOf(quietHours.start);
  return instantAt(endsTomorrow ? addDays(parts, 1) : parts, quietHours.end, timeZone);
}

function sameClockDaysLater(atMs: number, days: number, timeZone: string): number {
  const parts = localPartsAt(atMs, timeZone);
  return instantAt(addDays(parts, days), parts, timeZone);
}

function cappedCandidates({ prefs, triggers, now, timeZone }: PlanRequest): Candidate[] {
  const { enabled, dailyTime, quietHours } = prefs;
  const today = localPartsAt(now, timeZone);
  const candidates: Candidate[] = [];

  if (enabled.daily)
    for (let day = 0; day <= HORIZON_DAYS; day += 1)
      candidates.push({
        type: 'daily',
        atMs: instantAt(addDays(today, day), dailyTime, timeZone),
        createdFor: 'daily',
      });

  const confirmation = triggers.confirmationFor;
  if (enabled.confirmation && confirmation) {
    const takenOn = localPartsAt(confirmation.takenAt, timeZone);
    const sameDay = afterQuietHours(confirmation.takenAt + SAME_DAY_CONFIRMATION_MS, quietHours, timeZone);
    // Late in the day, quiet hours push the first reminder into the morning, which the second already covers.
    if (localDateKey(localPartsAt(sameDay, timeZone)) === localDateKey(takenOn))
      candidates.push({ type: 'confirmation', atMs: sameDay, createdFor: confirmation.readingId });
    // Readings at the same time each morning are the easiest to compare (§8.2 step 9).
    candidates.push({
      type: 'confirmation',
      atMs: instantAt(addDays(takenOn, 1), dailyTime, timeZone),
      createdFor: confirmation.readingId,
    });
  }

  const flagged = triggers.doctorFollowupFor;
  if (enabled['doctor-followup'] && flagged)
    candidates.push({
      type: 'doctor-followup',
      atMs: sameClockDaysLater(flagged.takenAt, DOCTOR_FOLLOWUP_DAYS, timeZone),
      createdFor: flagged.readingId,
    });

  if (enabled.retest && triggers.lastPhoneCheckAt !== null)
    candidates.push({
      type: 'retest',
      atMs: sameClockDaysLater(triggers.lastPhoneCheckAt, RETEST_DAYS, timeZone),
      createdFor: 'phone-check',
    });

  const horizonMs = sameClockDaysLater(now, HORIZON_DAYS, timeZone);
  const shifted = candidates
    .map((candidate) => ({ ...candidate, atMs: afterQuietHours(candidate.atMs, quietHours, timeZone) }))
    .filter(({ atMs }) => atMs <= horizonMs);

  // Ones already due today have fired (or were skipped) and cannot be taken back, so they use up today's
  // allowance before any new one does.
  const rank = ({ type, atMs }: Candidate) => (atMs <= now ? -1 : CAP_PRIORITY.indexOf(type));
  const perDay = new Map<string, number>();
  return shifted
    .sort((first, second) => rank(first) - rank(second) || first.atMs - second.atMs)
    .filter(({ atMs }) => {
      const day = localDateKey(localPartsAt(atMs, timeZone));
      const count = perDay.get(day) ?? 0;
      if (count >= DAILY_CAP) return false;
      perDay.set(day, count + 1);
      return true;
    })
    .filter(({ atMs }) => atMs > now);
}

// Standing-test alerts are exempt from quiet hours and the daily cap (owner decision): the protocol
// cannot wait until morning.
function standingCandidates({ prefs, triggers, now }: PlanRequest): Candidate[] {
  const startedAt = triggers.standingStartedAt;
  if (!prefs.enabled.standing || startedAt === null) return [];
  return STANDING_READING_MINUTES.map((minute) => ({
    type: 'standing' as const,
    atMs: startedAt + LYING_MS + minute * MINUTE_MS,
    createdFor: `standing-test-${startedAt}`,
  })).filter(({ atMs }) => atMs > now);
}

export function planNotifications(request: PlanRequest): PlannedNotification[] {
  return [...cappedCandidates(request), ...standingCandidates(request)]
    .sort((first, second) => first.atMs - second.atMs)
    .map(({ type, atMs, createdFor }) => {
      const fireAt = isoWithOffset(atMs, request.timeZone);
      return {
        id: `${ID_PREFIXES[type]}-${fireAt.slice(0, 16)}`,
        type,
        fireAt,
        route: ROUTES[type],
        createdFor,
      };
    });
}

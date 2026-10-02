import { File, Paths } from 'expo-file-system';

import { isRecord } from '../evidence';
import type { ClockTime } from './localTime';
import type { NotificationPrefs, NotificationType } from './plan';

// §8.2 step 9 and §12.5: the daily check stays off until turned on, at 8:00 am; quiet hours 9:00 pm–7:00 am.
const DEFAULT_PREFS: NotificationPrefs = {
  enabled: { daily: false, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
  dailyTime: { hour: 8, minute: 0 },
  quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
};

const PREFS_FILE = 'notification-prefs.json';

const prefsFile = () => new File(Paths.document, PREFS_FILE);

function clockOr(stored: unknown, fallback: ClockTime): ClockTime {
  if (!isRecord(stored)) return fallback;
  const { hour, minute } = stored;
  const valid =
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    Number(hour) >= 0 &&
    Number(hour) < 24 &&
    Number(minute) >= 0 &&
    Number(minute) < 60;
  return valid ? { hour: Number(hour), minute: Number(minute) } : fallback;
}

// Each field falls back to its default on its own, so a file from an older build keeps what it has.
function prefsFrom(stored: unknown): NotificationPrefs {
  if (!isRecord(stored)) return DEFAULT_PREFS;
  const enabled = isRecord(stored.enabled) ? stored.enabled : {};
  const quietHours = isRecord(stored.quietHours) ? stored.quietHours : {};
  const types = Object.keys(DEFAULT_PREFS.enabled) as NotificationType[];
  return {
    enabled: Object.fromEntries(
      types.map((type) => {
        const kept = enabled[type];
        return [type, typeof kept === 'boolean' ? kept : DEFAULT_PREFS.enabled[type]];
      }),
    ) as NotificationPrefs['enabled'],
    dailyTime: clockOr(stored.dailyTime, DEFAULT_PREFS.dailyTime),
    quietHours: {
      start: clockOr(quietHours.start, DEFAULT_PREFS.quietHours.start),
      end: clockOr(quietHours.end, DEFAULT_PREFS.quietHours.end),
    },
  };
}

export function loadNotificationPrefs(): NotificationPrefs {
  const file = prefsFile();
  if (!file.exists) return DEFAULT_PREFS;
  const text = file.textSync();
  try {
    return prefsFrom(JSON.parse(text));
  } catch (error) {
    // A damaged file must not stop the app opening; defaults apply and the next save replaces it.
    console.warn(`Notification settings could not be read, using defaults: ${String(error)}`);
    return DEFAULT_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  const file = prefsFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(prefs));
}

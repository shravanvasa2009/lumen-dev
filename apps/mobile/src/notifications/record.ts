import { File, Paths } from 'expo-file-system';

import { isRecord } from '../evidence';
import { ID_PREFIXES, type NotificationType, type PlannedNotification } from './plan';

// Kept beside the notification settings: what the last sync actually scheduled, so the 3-a-day cap can
// count reminders that already fired even after the settings that planned them change.
const RECORD_FILE = 'notification-schedule.json';

const recordFile = () => new File(Paths.document, RECORD_FILE);

const isType = (value: unknown): value is NotificationType =>
  typeof value === 'string' && value in ID_PREFIXES;

function entryFrom(stored: unknown): PlannedNotification[] {
  if (!isRecord(stored)) return [];
  const { id, type, fireAt, route, createdFor } = stored;
  const valid =
    typeof id === 'string' &&
    isType(type) &&
    typeof fireAt === 'string' &&
    !Number.isNaN(Date.parse(fireAt)) &&
    typeof route === 'string' &&
    typeof createdFor === 'string';
  return valid ? [{ id, type, fireAt, route, createdFor }] : [];
}

export function loadScheduleRecord(): PlannedNotification[] {
  const file = recordFile();
  if (!file.exists) return [];
  const text = file.textSync();
  try {
    const stored: unknown = JSON.parse(text);
    return Array.isArray(stored) ? stored.flatMap(entryFrom) : [];
  } catch (error) {
    // A damaged record must not stop reminders; the next sync writes a fresh one.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Notification schedule record could not be read, starting a new one: ${reason}`);
    return [];
  }
}

export function saveScheduleRecord(entries: readonly PlannedNotification[]): void {
  const file = recordFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(entries));
}

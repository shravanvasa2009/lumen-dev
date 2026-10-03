import { Directory, File, Paths } from 'expo-file-system';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications';

import { clearDemoReadings } from '@/demo/demoReadings';
import { exitDemo } from '@/demo/demoSession';
import { removeExportFile } from '@/export/exportFile';
import { keepCapture } from '@/measure/keptCapture';
import type { NotificationPrefs, NotificationTriggers } from '@/notifications/plan';
import { syncNotifications } from '@/notifications/scheduler';
import { resetDoctorPhone } from '@/profile/doctorPhone';
import { resetPreferences } from '@/theme/preferences';

import { lumenDatabase } from './database';

// The notification settings and the schedule record sit beside the app's other documents. Their names
// belong to src/notifications; deleteAllData.test.ts saves through those modules and checks nothing is left,
// so a renamed file fails there.
const NOTIFICATION_FILES = ['notification-prefs.json', 'notification-schedule.json'];

const NOTHING_ENABLED: NotificationPrefs = {
  enabled: { daily: false, confirmation: false, 'doctor-followup': false, standing: false, retest: false },
  dailyTime: { hour: 8, minute: 0 },
  quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
};

const NO_TRIGGERS: NotificationTriggers = {
  confirmationFor: null,
  doctorFollowupFor: null,
  standingStartedAt: null,
  lastPhoneCheckAt: null,
};

// expo-print writes its PDFs to <cache>/Print (ReportView also deletes each one after sharing).
const PRINT_FOLDER = 'Print';

// secure_delete zeroes freed pages and VACUUM rewrites the file, so deleted values do not linger in free
// pages. VACUUM cannot run inside a transaction, so it follows it.
// Every table is emptied, found from the schema, so a table added later is wiped without editing this list.
async function emptyEveryTable(): Promise<void> {
  const database = await lumenDatabase();
  await database.execAsync('PRAGMA secure_delete = ON');
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  await database.withTransactionAsync(async () => {
    for (const { name } of tables) await database.runAsync(`DELETE FROM "${name}"`);
  });
  await database.execAsync('VACUUM');
}

// PRIV-1. A sync with every reminder off runs first: syncNotifications queues, so a sync already running
// finishes its schedule and file writes before anything is deleted, and then the system's reminders are
// cancelled so none fires or is re-planned meanwhile. Captures are held in memory
// only, so nothing is on disk for them; the downloaded models are not the person's data and stay. A failure
// throws before any in-memory state resets, and running it again finishes the job.
// expo-notifications 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
// expo-file-system 57: https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/
export async function deleteAllData(languageTag: string): Promise<void> {
  await syncNotifications(
    {
      prefs: NOTHING_ENABLED,
      triggers: NO_TRIGGERS,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    languageTag,
  );
  await cancelAllScheduledNotificationsAsync();
  await emptyEveryTable();
  for (const name of NOTIFICATION_FILES) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  }
  const printed = new Directory(Paths.cache, PRINT_FOLDER);
  if (printed.exists) printed.delete();
  removeExportFile();
  keepCapture(null);
  clearDemoReadings();
  resetPreferences();
  resetDoctorPhone();
  exitDemo();
}

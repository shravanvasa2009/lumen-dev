import { File, Paths } from 'expo-file-system';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications';

import { clearDemoReadings } from '@/demo/demoReadings';
import { exitDemo } from '@/demo/demoSession';
import { keepCapture } from '@/measure/keptCapture';
import { resetDoctorPhone } from '@/profile/doctorPhone';
import { resetPreferences } from '@/theme/preferences';

import { lumenDatabase } from './database';

// The notification settings and the schedule record sit beside the app's other documents. Their names
// belong to src/notifications; deleteAllData.test.ts saves through those modules and checks nothing is left,
// so a renamed file fails there.
const NOTIFICATION_FILES = ['notification-prefs.json', 'notification-schedule.json'];

// Every table is emptied, found from the schema, so a table added later is wiped without editing this list.
async function emptyEveryTable(): Promise<void> {
  const database = await lumenDatabase();
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  await database.withTransactionAsync(async () => {
    for (const { name } of tables) await database.runAsync(`DELETE FROM "${name}"`);
  });
}

// PRIV-1. Reminders are cancelled first so none fires while the rest is deleted. Captures are held in memory
// only, so nothing is on disk for them; the downloaded models are not the person's data and stay. A failure
// throws before any in-memory state resets, and running it again finishes the job.
// expo-notifications 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
// expo-file-system 57: https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/
export async function deleteAllData(): Promise<void> {
  await cancelAllScheduledNotificationsAsync();
  await emptyEveryTable();
  for (const name of NOTIFICATION_FILES) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  }
  keepCapture(null);
  clearDemoReadings();
  resetPreferences();
  resetDoctorPhone();
  exitDemo();
}

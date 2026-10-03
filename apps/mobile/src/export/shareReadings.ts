import * as Sharing from 'expo-sharing';

import { listReadings } from '@/store/readings';

import { exportFile, removeExportFile } from './exportFile';
import { readingsToCsv } from './readingsCsv';

export type ExportOutcome = 'shared' | 'empty' | 'unavailable';

// Only readings saved on this phone are exported: Demo readings are never written to the readings table.
// PRIV-1: the file holds health values, so it is deleted from the cache once the share sheet closes. The
// share sheet hands the file to an app the person picks; Lumen itself sends nothing anywhere.
// expo-file-system 57: https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/
// expo-sharing 57: https://docs.expo.dev/versions/v57.0.0/sdk/sharing/
export async function shareReadingsCsv(): Promise<ExportOutcome> {
  const readings = await listReadings();
  if (readings.length === 0) return 'empty';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = exportFile();
  try {
    file.create({ overwrite: true });
    file.write(readingsToCsv(readings));
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } finally {
    removeExportFile();
  }
  return 'shared';
}

import { File, Paths } from 'expo-file-system';

export const exportFile = (): File => new File(Paths.cache, 'lumen-readings.csv');

// PRIV-1: the app can be killed while the share sheet is open, so Delete all data removes the file too.
export function removeExportFile(): void {
  const file = exportFile();
  if (file.exists) file.delete();
}

import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';

import type { LiveCapture } from './useLiveCapture';

// Shown under the denied caption: the system will not ask again, so Settings is the only way to turn the camera on.
export function OpenSettingsButton({ live }: { live: LiveCapture }) {
  const { t } = useTranslation();
  if (live.phase !== 'denied') return null;
  return (
    <Button variant="secondary" label={t('capture.openSettings')} onPress={() => void Linking.openSettings()} />
  );
}

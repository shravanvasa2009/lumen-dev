import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { phaseCaption } from './phaseCaption';
import type { LiveCapture } from './useLiveCapture';

// Sits at the top of the scrolling body, above the finger preview: on a 360x640 phone the caption and button
// would otherwise be below the fold, and the system may not ask again, so Settings is the only way back.
export function CameraDeniedNotice({ live, centered = false }: { live: LiveCapture; centered?: boolean }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  if (live.phase !== 'denied') return null;
  return (
    <View style={{ gap: spacing.md }}>
      <AppText tone="textDim" style={centered ? { textAlign: 'center' } : undefined}>
        {phaseCaption(t, live)}
      </AppText>
      <Button
        variant="secondary"
        label={t('capture.openSettings')}
        onPress={() => void Linking.openSettings()}
      />
    </View>
  );
}

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Screen } from './Screen';

// Calm and neutral on purpose: red is for the emergency screen only (SAFE-1).
export function StorageErrorScreen({ retry }: { retry: () => Promise<void> }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  // The boundary sits above the navigator, so it cannot know which screen failed, and retrying remounts the
  // navigator from its first route; Home is the one screen every launch can reach.
  const retryAtHome = async () => {
    await retry();
    router.replace('/');
  };
  return (
    <Screen headerless footer={<Button label={t('error.retry')} onPress={() => void retryAtHome()} />}>
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
        <AppText variant="title" accessibilityRole="header">
          {t('error.title')}
        </AppText>
        <AppText tone="textDim">{t('error.body')}</AppText>
      </View>
    </Screen>
  );
}

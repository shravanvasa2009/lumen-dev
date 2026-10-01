import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('app.name') }} />
      <AppText variant="display">{t('app.name')}</AppText>
      <AppText tone="textDim">{t('app.tagline')}</AppText>
    </Screen>
  );
}

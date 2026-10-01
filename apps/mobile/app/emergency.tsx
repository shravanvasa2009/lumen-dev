import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { RouteShell } from '@/components/RouteShell';

export default function EmergencyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <RouteShell title={t('emergency.title')} subtitle={t('emergency.body')} titleTone="criticalText">
      <Button label={t('emergency.call')} variant="critical" onPress={() => Linking.openURL('tel:911')} />
      <Button
        label={t('emergency.okay')}
        variant="secondary"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <AppText variant="headline">{t('emergency.stroke')}</AppText>
      <AppText tone="textDim">{t('emergency.strokeLetters')}</AppText>
    </RouteShell>
  );
}

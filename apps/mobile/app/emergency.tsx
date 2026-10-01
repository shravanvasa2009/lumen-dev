import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { RouteShell } from '@/components/RouteShell';

export default function EmergencyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [callFailed, setCallFailed] = useState(false);
  // Simulators, tablets, and phones without a SIM can't open the dialer; the person must still be told
  // how to get help, so a failed call becomes visible instructions instead of an unhandled rejection.
  const callEmergency = () => Linking.openURL('tel:911').catch(() => setCallFailed(true));
  return (
    <RouteShell title={t('emergency.title')} subtitle={t('emergency.body')} titleTone="criticalText">
      <Button label={t('emergency.call')} variant="critical" onPress={callEmergency} />
      {callFailed ? (
        <AppText tone="criticalText" accessibilityRole="alert">
          {t('emergency.callFailed')}
        </AppText>
      ) : null}
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

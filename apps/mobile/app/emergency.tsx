import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { callNumber } from '@/profile/dial';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { useTheme } from '@/theme';

export default function EmergencyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing, control } = useTheme();
  const { phone: doctorPhone } = useDoctorPhone();
  const [callFailed, setCallFailed] = useState(false);
  const [doctorCallFailed, setDoctorCallFailed] = useState(false);
  // Simulators, tablets, and phones without a SIM can't open the dialer; the person must still be told
  // how to get help, so a failed call becomes visible instructions instead of an unhandled rejection.
  const callEmergency = () => Linking.openURL('tel:911').catch(() => setCallFailed(true));
  const callDoctor = async (phone: string) => setDoctorCallFailed(!(await callNumber(phone)));
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.emergencyBg, padding: spacing.screen }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
          <Icon name="warning" size={72} color={colors.criticalText} mark={colors.emergencyBg} />
          <AppText
            variant="display"
            tone="criticalText"
            accessibilityRole="header"
            style={{ textAlign: 'center' }}
          >
            {t('emergency.title')}
          </AppText>
          <AppText tone="criticalText" style={{ textAlign: 'center' }}>
            {t('emergency.body')}
          </AppText>
        </View>
      </View>
      <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
        <Button label={t('emergency.call')} variant="critical" onPress={callEmergency} />
        {callFailed ? (
          <AppText tone="criticalText" accessibilityRole="alert" style={{ textAlign: 'center' }}>
            {t('emergency.callFailed')}
          </AppText>
        ) : null}
        {doctorPhone ? (
          <>
            <Button
              label={t('careMap.callMyDoctor')}
              variant="secondary"
              onPress={() => void callDoctor(doctorPhone)}
            />
            {doctorCallFailed ? (
              <AppText tone="criticalText" accessibilityRole="alert" style={{ textAlign: 'center' }}>
                {t('careMap.callFailed')} <AppText selectable>{doctorPhone}</AppText>
              </AppText>
            ) : null}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={{ minHeight: control.minTarget, alignItems: 'center', justifyContent: 'center' }}
        >
          <AppText variant="headline" tone="criticalText">
            {t('emergency.okay')}
          </AppText>
        </Pressable>
        <View
          style={{
            borderColor: colors.criticalText,
            borderWidth: 1,
            borderRadius: radius.card,
            padding: spacing.lg,
            gap: spacing.xs,
          }}
        >
          <AppText variant="headline">{t('emergency.stroke')}</AppText>
          <AppText variant="caption" tone="criticalText">
            {t('emergency.strokeLetters')}
          </AppText>
        </View>
      </View>
    </SafeAreaView>
  );
}

import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { strokeLetters, type StrokeSign } from '@/learn/StrokeFigures';
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
  const strokeSigns: { key: StrokeSign; word: string }[] = [
    { key: 'balance', word: t('emergency.signBalance') },
    { key: 'eyes', word: t('emergency.signEyes') },
    { key: 'face', word: t('emergency.signFace') },
    { key: 'arm', word: t('emergency.signArm') },
    { key: 'speech', word: t('emergency.signSpeech') },
    { key: 'time', word: t('emergency.signTime') },
  ];
  const callDoctor = async (phone: string) => setDoctorCallFailed(!(await callNumber(phone)));
  const strokeCard = (
    <View
      style={{
        alignSelf: 'stretch',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.lg,
      }}
    >
      <AppText variant="headline" accessibilityRole="header">
        {t('emergency.stroke')}
      </AppText>
      <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
        {strokeSigns.map(({ key, word }) => (
          <View key={key} style={{ flex: 1, alignItems: 'center' }}>
            <AppText importantForAccessibility="no" variant="title" tone="criticalText">
              {strokeLetters[key]}
            </AppText>
            <AppText variant="caption" tone="textDim" numberOfLines={1} adjustsFontSizeToFit>
              {word}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.sm, fontWeight: '600' }}>
        {t('emergency.strokeCall')}
      </AppText>
    </View>
  );
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.emergencyBg, padding: spacing.screen }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {/* Only this block scrolls: Spanish text or a large font on a 360x640 phone must never push Call 911 off screen. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: spacing.huge, gap: spacing.lg }}
      >
        <Icon name="warning" size={64} color={colors.criticalText} />
        <AppText variant="display" tone="criticalText" accessibilityRole="header">
          {t('emergency.title')}
        </AppText>
        <AppText style={{ fontSize: 20, lineHeight: 26 }}>{t('emergency.body')}</AppText>
        <View style={{ paddingTop: spacing.lg }}>{strokeCard}</View>
      </ScrollView>
      <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
        <Button label={t('emergency.call')} variant="critical" icon="call" onPress={callEmergency} />
        {callFailed ? (
          <AppText tone="criticalText" accessibilityRole="alert" style={{ textAlign: 'center' }}>
            {t('emergency.callFailed')}
          </AppText>
        ) : null}
        {doctorPhone ? (
          <>
            <Button
              label={t('careMap.callMyDoctor')}
              variant="surface"
              icon="call"
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
          <AppText variant="headline">{t('emergency.okay')}</AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

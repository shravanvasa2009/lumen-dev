import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Glyph } from '@/results/Glyph';
import { useTheme } from '@/theme';

export default function EmergencyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing, control } = useTheme();
  const [callFailed, setCallFailed] = useState(false);
  // Simulators, tablets, and phones without a SIM can't open the dialer; the person must still be told
  // how to get help, so a failed call becomes visible instructions instead of an unhandled rejection.
  const callEmergency = () => Linking.openURL('tel:911').catch(() => setCallFailed(true));
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        headerless
        footer={
          <>
            <Button label={t('emergency.call')} variant="critical" onPress={callEmergency} />
            {callFailed ? (
              <AppText tone="criticalText" accessibilityRole="alert" style={{ textAlign: 'center' }}>
                {t('emergency.callFailed')}
              </AppText>
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
          </>
        }
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
          <Glyph name="warning" size={72} color={colors.criticalText} mark={colors.bg} />
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
      </Screen>
      {/* The tint sits over the screen because Screen paints the shared background; it ignores touches. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: colors.criticalFill,
          opacity: 0.1,
        }}
      />
    </View>
  );
}

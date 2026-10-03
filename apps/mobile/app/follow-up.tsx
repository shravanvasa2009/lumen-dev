import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

// HRSA's health-center finder; opened only when the person taps the link (spec 8.4).
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';
// One constant so moving the Care map to a tab later is a one-line change.
const CARE_MAP_ROUTE = '/care-map';
const GRABBER_WIDTH = 40;
const GRABBER_HEIGHT = 4;
const GRABBER_RADIUS = GRABBER_HEIGHT / 2;

export default function FollowUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const { top: statusBarInset } = useSafeAreaInsets();
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  const openCareFinder = () => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true));
  // The sheet closes first so the Care map opens as a normal screen instead of stacking on the sheet.
  const openCareMap = () => {
    if (router.canDismiss()) router.dismiss();
    router.push(CARE_MAP_ROUTE);
  };
  return (
    <Screen>
      {/* fitToContents sizes the sheet to this block; the cap keeps taller content (Spanish, large text,
          the care-finder fallback line) scrollable instead of clipped below the screen edge. */}
      <ScrollView
        style={{ maxHeight: windowHeight - statusBarInset }}
        contentContainerStyle={{ gap: spacing.md }}
      >
        {Platform.OS === 'android' ? (
          // sheetGrabberVisible is iOS-only; Android's Material sheet shows no handle of its own here.
          <View
            testID="sheet-grabber"
            style={{
              alignSelf: 'center',
              width: GRABBER_WIDTH,
              height: GRABBER_HEIGHT,
              borderRadius: GRABBER_RADIUS,
              backgroundColor: colors.line2,
            }}
          />
        ) : null}
        <AppText variant="title" accessibilityRole="header">
          {t('followUp.title')}
        </AppText>
        <AppText tone="textDim">{t('followUp.subtitle')}</AppText>
        <NavButton label={t('followUp.saw')} href="/" replace />
        <NavButton label={t('followUp.booked')} href="/" variant="secondary" replace />
        <NavButton label={t('followUp.notYet')} href="/" variant="secondary" replace />
        <Button label={t('careMap.enter')} variant="secondary" onPress={openCareMap} />
        <Card>
          <AppText variant="headline">{t('followUp.whatToAsk')}</AppText>
          <AppText tone="textDim">{t('followUp.whatToAskBody')}</AppText>
          <Pressable accessibilityRole="link" onPress={openCareFinder}>
            <AppText variant="headline" tone="accent">
              {t('followUp.careFinder')}
            </AppText>
          </Pressable>
          {careFinderFailed ? (
            <AppText variant="caption" tone="textDim" accessibilityRole="alert">
              {t('followUp.careFinderFailed')}
            </AppText>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

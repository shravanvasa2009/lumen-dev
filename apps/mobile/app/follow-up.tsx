import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useWindowInsets } from '@/demo/DemoStrip';
import { type FollowUpAnswer, saveFollowUpAnswer } from '@/profile/followUp';
import { resyncNotifications } from '@/settings/applyPrefs';
import { useTheme } from '@/theme';

// HRSA's health-center finder; opened only when the person taps the link (spec 8.4).
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';
// The Care map is a tab root (ADR 0065).
const CARE_MAP_ROUTE = '/care';
const GRABBER_WIDTH = 40;
const GRABBER_HEIGHT = 4;
const GRABBER_RADIUS = GRABBER_HEIGHT / 2;

export default function FollowUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useWindowInsets();
  // Screen pads the sheet by spacing.screen top and bottom and adds the bottom inset, so the scroll area
  // must leave room for all of them or its last lines sit below the screen edge.
  const scrollMaxHeight = windowHeight - insets.top - insets.bottom - 2 * spacing.screen;
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  const [answerFailed, setAnswerFailed] = useState(false);
  const openCareFinder = () => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true));
  // The sheet stays open when the answer cannot be saved, so a see-doctor status is not left standing silently.
  const answer = (choice: FollowUpAnswer) =>
    saveFollowUpAnswer(choice, Date.now()).then(
      () => {
        resyncNotifications();
        router.replace('/');
      },
      () => setAnswerFailed(true),
    );
  // The sheet closes first so the Care map opens as a normal screen instead of stacking on the sheet.
  const openCareMap = () => {
    if (router.canDismiss()) router.dismiss();
    router.push(CARE_MAP_ROUTE);
  };
  return (
    <Screen>
      {/* fitToContents sizes the sheet to this block; the cap keeps taller content (Spanish, large text,
          the care-finder fallback line) scrollable instead of clipped below the screen edge. */}
      <ScrollView style={{ maxHeight: scrollMaxHeight }} contentContainerStyle={{ gap: spacing.md }}>
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
        <Button label={t('followUp.saw')} onPress={() => void answer('saw')} />
        <Button label={t('followUp.booked')} variant="secondary" onPress={() => void answer('booked')} />
        <Button label={t('followUp.notYet')} variant="secondary" onPress={() => void answer('notYet')} />
        {answerFailed ? (
          <AppText variant="caption" tone="textDim" accessibilityRole="alert">
            {t('profile.saveFailed')}
          </AppText>
        ) : null}
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

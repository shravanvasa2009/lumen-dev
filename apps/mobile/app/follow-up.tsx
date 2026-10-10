import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { useWindowInsets } from '@/demo/DemoStrip';
import { type FollowUpAnswer, saveFollowUpAnswer } from '@/profile/followUp';
import { resyncNotifications } from '@/settings/applyPrefs';
import { useTheme } from '@/theme';
import { currentPreferences } from '@/theme/preferences';
import { publishWidgets } from '@/widgets/publish';

// HRSA's health-center finder; opened only when the person taps the link (spec 8.4).
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';
// The Care map is a tab root (ADR 0065).
const CARE_MAP_ROUTE = '/care';
const GRABBER_WIDTH = 40;
const GRABBER_HEIGHT = 4;
const GRABBER_RADIUS = GRABBER_HEIGHT / 2;
const CLOSE_TARGET = 44;
const CLOSE_DISC = 30;

export default function FollowUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing, control } = useTheme();
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
        void resyncNotifications();
        // A "saw a doctor" answer lifts the widget's held see-doctor status now, not at the next reading
        // (ADR 0005). The answer is saved, so a failed widget write is only reported.
        publishWidgets(currentPreferences()).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`Widget update failed: ${reason}`);
        });
        router.replace('/');
      },
      () => setAnswerFailed(true),
    );
  // Closing saves nothing: the question stays unanswered.
  const closeSheet = () => (router.canDismiss() ? router.dismiss() : router.replace('/'));
  // The sheet closes first so the Care map opens as a normal screen instead of stacking on the sheet.
  const openCareMap = () => {
    if (router.canDismiss()) router.dismiss();
    router.push(CARE_MAP_ROUTE);
  };
  return (
    <Screen>
      {/* fitToContents sizes the sheet to this block; the cap keeps taller content (Spanish, large text,
          the care-finder fallback line) scrollable instead of clipped below the screen edge. */}
      <ScrollView style={{ maxHeight: scrollMaxHeight }} contentContainerStyle={{ gap: spacing.sm }}>
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
        <View style={{ paddingRight: CLOSE_TARGET }}>
          <AppText variant="title" accessibilityRole="header">
            {t('followUp.title')}
          </AppText>
          <AppText variant="subheadline" tone="textDim" style={{ marginTop: spacing.xs }}>
            {t('followUp.subtitle')}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={closeSheet}
            style={{
              position: 'absolute',
              right: -spacing.sm,
              top: -spacing.sm,
              width: CLOSE_TARGET,
              height: CLOSE_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: CLOSE_DISC,
                height: CLOSE_DISC,
                borderRadius: CLOSE_DISC / 2,
                backgroundColor: colors.surface3,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" size={14} color={colors.textDim} />
            </View>
          </Pressable>
        </View>
        <Button label={t('followUp.saw')} onPress={() => void answer('saw')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t('followUp.booked')}
              variant="tint"
              compact
              onPress={() => void answer('booked')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t('followUp.notYet')}
              variant="tint"
              compact
              onPress={() => void answer('notYet')}
            />
          </View>
        </View>
        {answerFailed ? (
          <AppText variant="caption" tone="textDim" accessibilityRole="alert">
            {t('profile.saveFailed')}
          </AppText>
        ) : null}
        <Button label={t('careMap.enter')} variant="tint" compact icon="care" onPress={openCareMap} />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.md,
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            paddingTop: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xs,
          }}
        >
          <Icon name="hint" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <AppText variant="subheadline" style={{ fontWeight: '600' }}>
              {t('followUp.whatToAsk')}
            </AppText>
            <AppText variant="subheadline" tone="textDim" style={{ marginTop: 2 }}>
              {t('followUp.whatToAskBody')}
            </AppText>
            <Pressable
              accessibilityRole="link"
              onPress={openCareFinder}
              style={{ minHeight: control.minTarget, justifyContent: 'center' }}
            >
              <AppText variant="subheadline" tone="accent" style={{ fontWeight: '600' }}>
                {t('followUp.careFinder')}
              </AppText>
            </Pressable>
            {careFinderFailed ? (
              <AppText variant="caption" tone="textDim" accessibilityRole="alert">
                {t('followUp.careFinderFailed')}
              </AppText>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

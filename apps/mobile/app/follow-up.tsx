import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { type FollowUpAnswer, saveFollowUpAnswer } from '@/profile/followUp';
import { useTheme } from '@/theme';

// HRSA's health-center finder; opened only when the person taps the link (spec 8.4).
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';
const GRABBER_WIDTH = 40;

export default function FollowUpScreen() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const router = useRouter();
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  const [answerFailed, setAnswerFailed] = useState(false);
  const openCareFinder = () => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true));
  // The sheet stays open when the answer cannot be saved, so a see-doctor status is not left standing silently.
  const answer = (choice: FollowUpAnswer) =>
    saveFollowUpAnswer(choice, Date.now()).then(
      () => router.replace('/'),
      () => setAnswerFailed(true),
    );
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: radius.sheet,
            padding: spacing.xl,
            gap: spacing.md,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: GRABBER_WIDTH,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line2,
            }}
          />
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
          <NavButton label={t('careMap.enter')} href="/care-map" variant="secondary" />
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
        </View>
      </ScrollView>
    </Screen>
  );
}

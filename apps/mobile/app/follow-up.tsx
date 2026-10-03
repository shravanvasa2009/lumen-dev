import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

// HRSA's health-center finder; opened only when the person taps the link (spec 8.4).
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';

export default function FollowUpScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  const openCareFinder = () => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true));
  return (
    <Screen>
      <ScrollView>
        <View style={{ gap: spacing.md }}>
          <AppText variant="title" accessibilityRole="header">
            {t('followUp.title')}
          </AppText>
          <AppText tone="textDim">{t('followUp.subtitle')}</AppText>
          <NavButton label={t('followUp.saw')} href="/" replace />
          <NavButton label={t('followUp.booked')} href="/" variant="secondary" replace />
          <NavButton label={t('followUp.notYet')} href="/" variant="secondary" replace />
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

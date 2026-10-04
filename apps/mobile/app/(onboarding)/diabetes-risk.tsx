import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { OnboardingStep } from '@/components/OnboardingStep';
import { DiabetesRiskForm } from '@/profile/DiabetesRiskForm';
import { useRiskDraft } from '@/profile/useRiskDraft';
import { useTheme } from '@/theme';

export default function DiabetesRiskScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const risk = useRiskDraft('questions');
  // Every tap is stored at once, so Back and a restart keep the answers given so far.
  function answer(field: Parameters<typeof risk.change>[0], value: boolean) {
    risk.change(field, value);
    void risk.persist();
  }
  return (
    <OnboardingStep
      step={2}
      eyebrow={t('dr.stepOf', { a: 2, b: 2 })}
      title={t('dr.title')}
      subtitle={t('dr.intro')}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} />
          </View>
          <View style={{ flex: 2 }}>
            <Button label={t('common.continue')} onPress={() => router.push('/phone-check')} />
          </View>
        </View>
      }
    >
      {risk.loaded ? <DiabetesRiskForm draft={risk.draft} onAnswer={answer} /> : null}
      {risk.loadFailed ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {t('profile.loadFailed')}
        </AppText>
      ) : null}
      {risk.saveFailed ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {t('profile.saveFailed')}
        </AppText>
      ) : null}
    </OnboardingStep>
  );
}

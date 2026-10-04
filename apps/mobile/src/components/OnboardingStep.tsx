import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Screen } from './Screen';

const ONBOARDING_STEPS = 9;
const SEGMENT_HEIGHT = 4;

type OnboardingStepProps = {
  // 1 to ONBOARDING_STEPS: how many progress segments are filled.
  step: number;
  // A small line above the title, such as "Question set 1 of 2".
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

export function OnboardingStep({ step, eyebrow, title, subtitle, children, footer }: OnboardingStepProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <Screen headerless footer={footer}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('onboarding.step', { step, total: ONBOARDING_STEPS })}
        accessibilityValue={{ min: 1, max: ONBOARDING_STEPS, now: step }}
        style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}
      >
        {Array.from({ length: ONBOARDING_STEPS }, (_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: SEGMENT_HEIGHT,
              borderRadius: SEGMENT_HEIGHT / 2,
              backgroundColor: index < step ? colors.accent : colors.surface3,
            }}
          />
        ))}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          {eyebrow ? (
            <AppText variant="caption" tone="textFaint">
              {eyebrow}
            </AppText>
          ) : null}
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle ? <AppText tone="textDim">{subtitle}</AppText> : null}
        </View>
        <View style={{ gap: spacing.lg }}>{children}</View>
      </ScrollView>
    </Screen>
  );
}

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { FingerPreview, ProgressRing, SignalMeter } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

// Spec §8.2 step 6: practice passes after 15 steady seconds at Strong.
const STEADY_SECONDS_NEEDED = 15;
const TRACE_HEIGHT = 72;

// No capture controller feeds the app yet (the capture module is not wired into screens), so practice shows
// its starting state: no finger, no signal, no steady seconds.
const steadySeconds = 0;

export default function PracticeScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <OnboardingStep
      step={5}
      title={t('practice.title')}
      subtitle={t('practice.subtitle')}
      footer={
        <>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md }}
          >
            <ProgressRing fraction={steadySeconds / STEADY_SECONDS_NEEDED} />
            <AppText variant="headline">
              {t('practice.progress', { done: steadySeconds, total: STEADY_SECONDS_NEEDED })}
            </AppText>
          </View>
          <NavButton label={t('common.continue')} href="/how-to-sit" />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <FingerPreview detected={false} />
        <View
          accessibilityRole="alert"
          style={{
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderRadius: radius.pill,
            backgroundColor: colors.surface3,
          }}
        >
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            {t('coach.cover')}
          </AppText>
        </View>
      </View>
      <View style={{ gap: spacing.xs }}>
        <SignalMeter />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="caption" tone="textDim">
            {t('signal.weak')}
          </AppText>
          <AppText variant="caption" tone="textDim">
            {t('signal.ok')}
          </AppText>
          <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
            {t('signal.strong')}
          </AppText>
        </View>
      </View>
      <Card>
        <Svg width="100%" height={TRACE_HEIGHT} accessibilityElementsHidden>
          <Line
            x1="0%"
            y1={TRACE_HEIGHT / 2}
            x2="100%"
            y2={TRACE_HEIGHT / 2}
            stroke={colors.line2}
            strokeWidth={2}
          />
        </Svg>
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('practice.pending')}
      </AppText>
    </OnboardingStep>
  );
}

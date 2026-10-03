import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { coachingText } from '@/measure/coachingText';
import { LiveWaveform } from '@/measure/LiveWaveform';
import { phaseCaption } from '@/measure/phaseCaption';
import { useLiveCapture } from '@/measure/useLiveCapture';
import { FingerPreview, ProgressRing, SignalMeter, SignalScale } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

// H-047 option A (ADR 0074): practice passes after 30 steady seconds, not spec §8.2's 15, so it holds the
// 30 clean seconds DSP-10 needs for a perfusion index and the phone gets a real rating.
const STEADY_SECONDS_NEEDED = 30;

export default function PracticeScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const live = useLiveCapture();
  const fingerOn = live.status?.fingerCovered === true;
  // Counted by the LiveSession once it feeds the hook; until then there are none to show.
  const steadySeconds = Math.floor(live.cleanSeconds ?? 0);
  const caption =
    live.phase === 'unavailable'
      ? t('practice.pending')
      : (phaseCaption(t, live) ??
        (live.cleanSeconds === null ? t('capture.waiting') : t('capture.timerNote')));
  // With no finger the module's own contact flag is the coaching: Cover the lens and the flash.
  const coachingKey = live.coachingKey ?? (fingerOn ? null : 'coach.cover');
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
        <FingerPreview detected={fingerOn} />
        {coachingKey ? (
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
              {coachingText(t)[coachingKey]}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <SignalMeter />
        <SignalScale />
      </View>
      <Card>
        <LiveWaveform red={live.recentRed} />
      </Card>
      <AppText variant="caption" tone="textDim">
        {caption}
      </AppText>
    </OnboardingStep>
  );
}

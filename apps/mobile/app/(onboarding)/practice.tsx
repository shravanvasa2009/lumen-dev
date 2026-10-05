import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { CameraDeniedNotice } from '@/measure/CameraDeniedNotice';
import { coachingText } from '@/measure/coachingText';
import { LiveWaveform } from '@/measure/LiveWaveform';
import { phaseCaption } from '@/measure/phaseCaption';
import { useLiveCapture } from '@/measure/useLiveCapture';
import { FingerPreview, ProgressRing, SignalMeter, SignalScale } from '@/onboarding/practiceParts';
import { practiceSteadySeconds, STEADY_SECONDS_NEEDED } from '@/onboarding/practiceProgress';
import { useTheme } from '@/theme';

export default function PracticeScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const live = useLiveCapture();
  const fingerOn = live.status?.fingerCovered === true;
  // Counted by the LiveSession once it feeds the hook; until then there are none to show.
  const steadySeconds = practiceSteadySeconds(live.cleanSeconds);
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
          {/* Continue stays enabled: spec 08 §8.6 counts tutorial completion as the share of installs that pass this
              step, so some finish without passing, and a phone with no torch lens or camera permission cannot pass. */}
          <NavButton label={t('common.continue')} href="/how-to-sit" />
        </>
      }
    >
      <CameraDeniedNotice live={live} />
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
      {live.phase === 'denied' ? null : (
        <AppText variant="caption" tone="textDim">
          {caption}
        </AppText>
      )}
    </OnboardingStep>
  );
}

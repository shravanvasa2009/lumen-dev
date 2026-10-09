import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Card } from '@/components/Card';
import { OnboardingStep } from '@/components/OnboardingStep';
import { CameraDeniedNotice } from '@/measure/CameraDeniedNotice';
import { coachingText } from '@/measure/coachingText';
import { captureVerdict } from '@/measure/captureVerdict';
import { LiveWaveform } from '@/measure/LiveWaveform';
import { phaseCaption } from '@/measure/phaseCaption';
import { useLiveCapture } from '@/measure/useLiveCapture';
import { FingerPreview, ProgressRing, SignalMeter, SignalScale } from '@/onboarding/practiceParts';
import { usePracticeRating } from '@/onboarding/usePracticeRating';
import { practiceSteadySeconds, STEADY_SECONDS_NEEDED } from '@/onboarding/practiceProgress';
import { useTheme } from '@/theme';
import { easeOut, motion, reduceMotionMode, useReduceMotion } from '@/theme/motion';

// How long the done line shows before the screen moves on by itself.
const AUTO_ADVANCE_MS = 1500;

// Each attempt is a fresh capture: "Practice again" remounts the run.
export default function PracticeScreen() {
  const [attempt, setAttempt] = useState(0);
  return <PracticeRun key={attempt} onPracticeAgain={() => setAttempt((count) => count + 1)} />;
}

function PracticeRun({ onPracticeAgain }: { onPracticeAgain: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const mode = reduceMotionMode(reduceMotion);
  // The coaching line comes and goes while the finger moves; it fades, and what sits under it slides to its place
  // instead of jumping by the line's height.
  const fade = (animation: typeof FadeIn | typeof FadeOut) =>
    animation.duration(motion.durationMs).easing(easeOut).reduceMotion(mode);
  const settle = LinearTransition.duration(motion.durationMs).easing(easeOut).reduceMotion(mode);
  // The stack keeps this screen mounted under How to sit, and the rating reads the capture's last seconds, so
  // the camera stops when the screen is left.
  // Once the count reaches 30 the camera stops too, so the capture the rating reads ends on the good seconds.
  const [finished, setFinished] = useState(false);
  const focused = useIsFocused();
  const cameraOn = focused && !finished;
  const live = useLiveCapture(undefined, { enabled: cameraOn });
  const fingerOn = live.status?.fingerCovered === true;
  // Counted by the LiveSession once it feeds the hook; until then there are none to show.
  const steadySeconds = practiceSteadySeconds(live.cleanSeconds);
  useEffect(() => {
    if (steadySeconds >= STEADY_SECONDS_NEEDED) setFinished(true);
  }, [steadySeconds]);
  const rating = usePracticeRating(finished);
  const router = useRouter();
  useEffect(() => {
    if (rating === 'rated') AccessibilityInfo.announceForAccessibility(t('practice.done'));
    if (rating === 'unrated') AccessibilityInfo.announceForAccessibility(t('rating.pending'));
  }, [rating, t]);
  // The stack keeps this screen mounted under How to sit, so the automatic step happens once per run and only
  // while this screen is showing; Continue counts as that step too, and still works again after Back.
  const advanced = useRef(false);
  const goToHowToSit = () => {
    advanced.current = true;
    router.push('/how-to-sit');
  };
  useEffect(() => {
    if (rating !== 'rated' || !focused) return;
    const timer = setTimeout(() => {
      if (advanced.current) return;
      advanced.current = true;
      router.push('/how-to-sit');
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [rating, focused, router]);
  const shownSeconds = finished ? STEADY_SECONDS_NEEDED : steadySeconds;
  const caption =
    live.phase === 'unavailable'
      ? t('practice.pending')
      : (phaseCaption(t, live) ??
        (live.cleanSeconds === null ? t('capture.waiting') : t('capture.timerNote')));
  // With no finger the module's own contact flag is the coaching: Cover the lens and the flash.
  const verdict = captureVerdict(live);
  const cameraShown = cameraOn && live.nativeCamera && live.phase === 'running';
  // With the camera off (done, or screen left) there is no live finger to coach. Without a finger, covering the
  // lens comes before any stalled-count line.
  const coachingKey = cameraOn ? (fingerOn ? verdict.coaching : 'coach.cover') : null;
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
            <ProgressRing fraction={shownSeconds / STEADY_SECONDS_NEEDED} />
            <AppText variant="headline">
              {t('practice.progress', { done: shownSeconds, total: STEADY_SECONDS_NEEDED })}
            </AppText>
            {rating === 'rated' ? <Icon name="check" size={24} color={colors.accent} /> : null}
          </View>
          {/* Continue stays enabled: spec 08 §8.6 counts tutorial completion as the share of installs that pass this
              step, so some finish without passing, and a phone with no torch lens or camera permission cannot pass. */}
          <Button label={t('common.continue')} onPress={goToHowToSit} />
        </>
      }
    >
      <CameraDeniedNotice live={live} />
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <FingerPreview detected={fingerOn} cameraRunning={cameraShown} coaching={coachingKey !== null} />
        {coachingKey ? (
          <Animated.View
            entering={fade(FadeIn)}
            exiting={fade(FadeOut)}
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
          </Animated.View>
        ) : null}
      </View>
      <Animated.View layout={settle} style={{ gap: spacing.xs }}>
        <SignalMeter level={verdict.level} />
        <SignalScale level={verdict.level} />
      </Animated.View>
      <Animated.View layout={settle}>
        <Card>
          <LiveWaveform
            pulse={live.recentPulse}
            red={live.recentRed}
            pulseTimesS={live.recentWaveform.tS}
            redTimesS={live.recentRedTS}
          />
        </Card>
      </Animated.View>
      {rating === 'rated' ? (
        <Animated.View layout={settle}>
          <AppText tone="accent" style={{ fontWeight: '600' }}>
            {t('practice.done')}
          </AppText>
        </Animated.View>
      ) : null}
      {rating === 'unrated' ? (
        <Animated.View layout={settle} style={{ gap: spacing.md }}>
          <AppText tone="textDim">{t('rating.pending')}</AppText>
          <Button label={t('rating.practiceAgain')} variant="secondary" onPress={onPracticeAgain} />
        </Animated.View>
      ) : null}
      {live.phase === 'denied' || finished ? null : (
        <Animated.View layout={settle}>
          <AppText variant="caption" tone="textDim">
            {caption}
          </AppText>
        </Animated.View>
      )}
    </OnboardingStep>
  );
}

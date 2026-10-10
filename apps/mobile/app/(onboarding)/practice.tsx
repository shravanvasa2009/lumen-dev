import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Screen } from '@/components/Screen';
import { CameraDeniedNotice } from '@/measure/CameraDeniedNotice';
import { coachingText } from '@/measure/coachingText';
import { captureVerdict } from '@/measure/captureVerdict';
import { LiveWaveform } from '@/measure/LiveWaveform';
import { phaseCaption } from '@/measure/phaseCaption';
import { TipsSheet } from '@/measure/TipsSheet';
import { useLiveCapture } from '@/measure/useLiveCapture';
import { OnboardingHeader } from '@/onboarding/OnboardingFrame';
import { PracticeDial } from '@/onboarding/PracticeDial';
import { PracticeSignal } from '@/onboarding/PracticeSignal';
import { practiceSteadySeconds, STEADY_SECONDS_NEEDED } from '@/onboarding/practiceProgress';
import { usePracticeRating } from '@/onboarding/usePracticeRating';
import { useTheme } from '@/theme';
import { easeOut, motion, reduceMotionMode, useReduceMotion } from '@/theme/motion';

// How long the done line shows before the screen moves on by itself.
const AUTO_ADVANCE_MS = 1500;
const DIAL_MAX = 280;
// The dial takes this share of the window height, so a 360 x 640 phone keeps the buttons in reach.
const DIAL_HEIGHT_SHARE = 0.32;

type CheckName = 'finger' | 'still' | 'pressure';

function CheckChip({ name, good }: { name: CheckName; good: boolean }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const checkLabel = {
    finger: t('capture.finger'),
    still: t('capture.still'),
    pressure: t('capture.pressure'),
  };
  const label = checkLabel[name];
  return (
    <View
      accessible
      accessibilityLabel={
        good ? t('practice.checkOk', { name: label }) : t('practice.checkNotYet', { name: label })
      }
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm - 2 }}
    >
      {good ? (
        <Icon name="check" size={14} color={colors.accent} />
      ) : (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            borderWidth: 2,
            borderColor: colors.textFaint,
            marginHorizontal: 2,
          }}
        />
      )}
      <AppText variant="caption" style={{ fontWeight: '500' }}>
        {label}
      </AppText>
    </View>
  );
}

// Each attempt is a fresh capture: "Practice again" remounts the run.
export default function PracticeScreen() {
  const [attempt, setAttempt] = useState(0);
  return <PracticeRun key={attempt} onPracticeAgain={() => setAttempt((count) => count + 1)} />;
}

function PracticeRun({ onPracticeAgain }: { onPracticeAgain: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const mode = reduceMotionMode(reduceMotion);
  // The coaching line comes and goes while the finger moves; it fades, and what sits under it slides to its place
  // instead of jumping by the line's height.
  const fade = (animation: typeof FadeIn | typeof FadeOut) =>
    animation.duration(motion.durationMs).easing(easeOut).reduceMotion(mode);
  const settle = LinearTransition.duration(motion.durationMs).easing(easeOut).reduceMotion(mode);
  const [tipsOpen, setTipsOpen] = useState(false);
  // The stack keeps this screen mounted under the rating, which reads the capture's last seconds, so the camera
  // stops when the screen is left.
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
  // The stack keeps this screen mounted under the rating, so the automatic step happens once per run and only
  // while this screen is showing; Continue counts as that step too, and still works again after Back.
  const advanced = useRef(false);
  const goToRating = () => {
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
  const dialSize = Math.round(
    Math.min(DIAL_MAX, windowWidth - 2 * spacing.screen, windowHeight * DIAL_HEIGHT_SHARE),
  );
  const checking = fingerOn && cameraOn;
  return (
    <Screen
      headerless
      footer={
        <>
          {/* Continue waits for the 30 seconds. Skip practice is the way on for a phone that cannot pass (no torch
              lens, or camera permission refused); spec 08 §8.6 counts those as an unfinished tutorial. */}
          <Button label={t('common.continue')} disabled={!finished} onPress={goToRating} />
          <Button label={t('practice.skip')} variant="link" onPress={goToRating} />
        </>
      }
    >
      <OnboardingHeader
        step={4}
        barTitle={t('practice.title')}
        trailing={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('capture.tips')}
            onPress={() => setTipsOpen(true)}
            style={{
              width: control.minTarget,
              height: control.minTarget,
              borderRadius: control.minTarget / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
            }}
          >
            <Icon name="hint" size={control.chevronSize} color={colors.text} />
          </PressableScale>
        }
      />
      <TipsSheet visible={tipsOpen} onDismiss={() => setTipsOpen(false)} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <AppText tone="textDim" style={{ textAlign: 'center', fontSize: 15, lineHeight: 20 }}>
          {t('practice.subtitle')}
        </AppText>
        <CameraDeniedNotice live={live} />
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <PracticeDial
            seconds={shownSeconds}
            total={STEADY_SECONDS_NEEDED}
            size={dialSize}
            cameraRunning={cameraShown}
            fingerDetected={fingerOn}
            coaching={coachingKey !== null}
          />
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
        <Animated.View layout={settle}>
          <PracticeSignal level={verdict.level} />
        </Animated.View>
        <Animated.View layout={settle}>
          <LiveWaveform
            pulse={live.recentPulse}
            red={live.recentRed}
            pulseTimesS={live.recentWaveform.tS}
            redTimesS={live.recentRedTS}
            withFact={false}
          />
        </Animated.View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl }}>
          <CheckChip name="finger" good={fingerOn} />
          <CheckChip name="still" good={checking && coachingKey !== 'coach.still'} />
          <CheckChip name="pressure" good={checking && coachingKey !== 'coach.lighter'} />
        </View>
        {rating === 'rated' ? (
          <Animated.View layout={settle}>
            <AppText tone="accent" style={{ fontWeight: '600', textAlign: 'center' }}>
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
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
              {caption}
            </AppText>
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

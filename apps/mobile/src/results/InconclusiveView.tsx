import { Stack, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import type { InconclusiveOutcome, LostCause } from '@lumen/core';

import { dominantCause, type FixCause } from '@/fix/causes';
import type { MeasureMode } from '@/measure/mode';
import { useTheme } from '@/theme';

import type { FixtureReading } from './fixtures';
import { DemoBanner } from './DemoBanner';
import { Icon } from '@/components/Icon';
import { LostTime } from './LostTime';

const causeWord = (t: TFunction, cause: LostCause) =>
  ({
    motion: t('inconclusive.causeMovement'),
    pressure: t('inconclusive.causePressure'),
    coverage: t('inconclusive.causeLight'),
    coldHands: t('inconclusive.causeColdHands'),
  })[cause];

function summary(t: TFunction, seconds: number, biggest: LostCause | null): string {
  return biggest === null
    ? t('inconclusive.gotOnly', { seconds })
    : t('inconclusive.got', { seconds, cause: causeWord(t, biggest) });
}

// One tip per lost-time cause; the two causes that lost the most pick the two tips (§12 screen 19).
function tipFor(t: TFunction, cause: LostCause): string {
  return {
    motion: t('inconclusive.tipElbows'),
    pressure: t('inconclusive.tipPressure'),
    coverage: t('inconclusive.tipCover'),
    coldHands: t('fix.tipWarm'),
  }[cause];
}

function tipsFor(t: TFunction, causes: readonly LostCause[]): string[] {
  const tips = causes.slice(0, 2).map((cause) => tipFor(t, cause));
  for (const fallback of [t('inconclusive.tipElbows'), t('inconclusive.tipBreathe')])
    if (tips.length < 2 && !tips.includes(fallback)) tips.push(fallback);
  return tips;
}

type InconclusiveViewProps = {
  reading: FixtureReading | undefined;
  outcome: InconclusiveOutcome | null;
  mode: MeasureMode;
};

export function InconclusiveView({ reading, outcome, mode }: InconclusiveViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  const lost = outcome?.lostSeconds ?? reading?.scan.lostSeconds ?? null;
  const cause: FixCause | null = outcome ? (outcome.causes[0] ?? null) : lost ? dominantCause(lost) : null;
  const tips = tipsFor(t, outcome?.causes ?? []);
  const seconds = outcome?.cleanSeconds ?? reading?.scan.cleanSeconds ?? null;
  const biggest = outcome ? (outcome.causes[0] ?? null) : cause;
  const fixHref = `/measure/fix-technique?mode=${mode}${cause ? `&cause=${cause}` : ''}` as const;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        headerless
        footer={
          <>
            <NavButton label={t('inconclusive.retake')} href={`/measure/capture?mode=${mode}`} replace />
            <NavButton label={t('inconclusive.fix')} href={fixHref} variant="secondary" />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/measure/capture?mode=quick')}
              style={{ minHeight: control.minTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppText variant="headline" tone="accent">
                {t('inconclusive.tryQuick')}
              </AppText>
            </Pressable>
          </>
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inconclusive.close')}
          hitSlop={spacing.md}
          onPress={() => router.replace('/')}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Icon name="close" size={control.chevronSize + 4} color={colors.textDim} />
        </Pressable>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg }}>
          {reading && !outcome ? <DemoBanner synthetic={reading.synthetic} /> : null}
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Icon name="noSignal" size={56} color={colors.flag} />
            <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('result.inconclusive')}
            </AppText>
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {seconds === null ? t('inconclusive.generic') : summary(t, seconds, biggest)}
            </AppText>
            {outcome ? (
              <AppText tone="textDim" style={{ textAlign: 'center' }}>
                {t('inconclusive.needed', { seconds: outcome.neededCleanSeconds })}
              </AppText>
            ) : null}
          </View>
          <LostTime lost={lost} />
          <Card>
            {tips.map((tip) => (
              <View key={tip} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Icon name="hint" size={20} color={colors.accent} />
                <AppText style={{ flex: 1 }}>{tip}</AppText>
              </View>
            ))}
          </Card>
        </View>
      </Screen>
    </>
  );
}

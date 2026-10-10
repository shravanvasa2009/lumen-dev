import { Stack, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { InconclusiveOutcome, LostCause } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';

import { dominantCause, type FixCause } from '@/fix/causes';
import { INCONCLUSIVE_REPORT_ID } from '@/report/inconclusiveReport';
import { cleanSecondsNeeded, type MeasureMode } from '@/measure/mode';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

import type { FixtureReading } from './fixtures';
import { DemoBanner } from './DemoBanner';
import { Icon, type IconName } from '@/components/Icon';
import { LostTime } from './LostTime';
import { ResultRing } from './ResultRing';

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

type Tip = { text: string; icon: IconName };

// One tip per lost-time cause; the two causes that lost the most pick the two tips (§12 screen 19).
function tipFor(t: TFunction, cause: LostCause): Tip {
  const tips: Record<LostCause, Tip> = {
    motion: { text: t('inconclusive.tipElbows'), icon: 'elbow' },
    pressure: { text: t('inconclusive.tipPressure'), icon: 'hint' },
    coverage: { text: t('inconclusive.tipCover'), icon: 'hint' },
    coldHands: { text: t('fix.tipWarm'), icon: 'hint' },
  };
  return tips[cause];
}

function tipsFor(t: TFunction, causes: readonly LostCause[]): Tip[] {
  const tips = causes.slice(0, 2).map((cause) => tipFor(t, cause));
  const fallbacks: Tip[] = [tipFor(t, 'motion'), { text: t('inconclusive.tipBreathe'), icon: 'hint' }];
  for (const fallback of fallbacks)
    if (tips.length < 2 && !tips.some((tip) => tip.text === fallback.text)) tips.push(fallback);
  return tips;
}

type InconclusiveViewProps = {
  reading: FixtureReading | undefined;
  outcome: InconclusiveOutcome | null;
  mode: MeasureMode;
  // The pre-check answers, as the route carries them, so the report can list them.
  context?: string;
};

export function InconclusiveView({ reading, outcome, mode, context }: InconclusiveViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  const lost = outcome?.lostSeconds ?? reading?.scan.lostSeconds ?? null;
  const cause: FixCause | null = outcome ? (outcome.causes[0] ?? null) : lost ? dominantCause(lost) : null;
  const tips = tipsFor(t, outcome?.causes ?? []);
  // Whole seconds, as the capture screen counts them; core's count is fractional.
  const measured = outcome?.cleanSeconds ?? reading?.scan.cleanSeconds ?? null;
  const seconds = measured === null ? null : Math.floor(measured);
  // The mode's target when no refused capture is in hand (a sample reading).
  const needed = outcome?.neededCleanSeconds ?? cleanSecondsNeeded(mode);
  const biggest = outcome ? (outcome.causes[0] ?? null) : cause;
  const reportHref: string =
    outcome || !reading
      ? `/report/${INCONCLUSIVE_REPORT_ID}${context ? `?context=${context}` : ''}`
      : `/report/${reading.id}`;
  const fixHref = `/measure/fix-technique?mode=${mode}${cause ? `&cause=${cause}` : ''}` as const;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        headerless
        footer={
          <>
            <NavButton label={t('inconclusive.retake')} href={`/measure/capture?mode=${mode}`} replace />
            <NavButton label={t('inconclusive.fix')} href={fixHref} variant="tint" />
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
        <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.lg }}>
          {reading && !outcome ? <DemoBanner synthetic={reading.synthetic} /> : null}
          {seconds !== null ? (
            <ResultRing
              value={String(seconds)}
              unit={t('inconclusive.ringUnit', { needed })}
              label={t('inconclusive.ringLabel', { seconds, needed })}
              progress={seconds / needed}
              large
            />
          ) : (
            <Icon name="noSignal" size={56} color={colors.flag} />
          )}
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('result.inconclusive')}
            </AppText>
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {seconds === null ? t('inconclusive.generic') : summary(t, seconds, biggest)}
            </AppText>
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('inconclusive.needed', { seconds: needed })}
            </AppText>
          </View>
          <LostTime lost={lost} />
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('inconclusive.tryNext')}</SectionLabel>
            <Card flush>
              {tips.map((tip, index) => (
                <ListRow
                  key={tip.text}
                  leading={<Icon name={tip.icon} size={20} color={colors.accent} />}
                  title={tip.text}
                  last={index === tips.length - 1}
                />
              ))}
            </Card>
          </View>
          <Card flush>
            <ListRow
              leading={<Icon name="share" size={20} color={colors.accent} />}
              title={t('results.doctorReport')}
              subtitle={t('inconclusive.reportNote')}
              chevron
              last
              onPress={() => router.push(reportHref)}
            />
          </Card>
        </ScrollView>
      </Screen>
    </>
  );
}

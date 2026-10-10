import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { HeartRateChart } from '@/standing/HeartRateChart';
import { formatClock, LYING_MS, STEP_COUNT } from '@/standing/protocol';
import { PostureFigure } from '@/standing/PostureFigure';
import { SafetyCard } from '@/standing/SafetyCard';
import { StandingDial } from '@/standing/StandingDial';
import { StandingIntro } from '@/standing/StandingIntro';
import { StepBar } from '@/standing/StepBar';
import { useStandingLiveTimer } from '@/standing/useStandingLiveTimer';
import { type StandingTestSource, useStandingTest } from '@/standing/useStandingTest';
import { useTheme } from '@/theme';

const NO_VALUE = '—';
const STANDING_PHASE_MS = 10 * 60_000;
const FIGURE_HEIGHT = 64;

function formatRise(rise: number | null): string {
  if (rise === null) return NO_VALUE;
  return rise > 0 ? `+${rise}` : String(rise);
}

function Tile({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1 }}>
      <Card dense>
        <AppText variant="caption" tone="textDim">
          {label}
        </AppText>
        <AppText variant="title">{value}</AppText>
        <AppText variant="caption" tone="textDim">
          {value === NO_VALUE ? ' ' : t('home.unitBpm')}
        </AppText>
      </Card>
    </View>
  );
}

export function StandingTestScreen({ source }: { source: StandingTestSource }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const { view, canRead, reading, readFailed, start, takeReading, stopForFaint } = useStandingTest(source);
  useStandingLiveTimer(view);

  const stageNames = {
    lying: t('standing.stage.lying'),
    baseline: t('standing.stage.baseline'),
    standing: t('standing.stage.standing'),
    final: t('standing.stage.final'),
    done: t('standing.stage.done'),
  };
  const headings = {
    intro: t('standing.heading.intro'),
    lying: t('standing.heading.lying'),
    baseline: t('standing.heading.baseline'),
    standing: t('standing.heading.standing'),
    final: t('standing.heading.final'),
    done: t('standing.heading.done'),
  };
  const heading = view.stopped ? t('standing.heading.stopped') : headings[view.stage];
  const stepText =
    view.stage === 'intro'
      ? t('standing.stepsCount', { total: STEP_COUNT })
      : t('standing.step', { step: view.step, total: STEP_COUNT, stage: stageNames[view.stage] });

  const interval = t('standing.interval');
  const nextReading =
    view.nextReadingAtMs === null
      ? interval
      : `${t('standing.next', { time: formatClock(view.nextReadingAtMs).replace(/^0/, '') })} ${interval}`;

  const lyingPhase = view.stage === 'lying' || view.stage === 'baseline';
  const standingPhase = view.stage === 'standing' || view.stage === 'final';
  const nextInMs = view.nextReadingInMs;
  const dial = view.stopped ? null : lyingPhase ? (
    <StandingDial
      fraction={1 - view.lyingRemainingMs / LYING_MS}
      label={t('standing.timeLeft')}
      clock={formatClock(view.lyingRemainingMs)}
      caption={
        view.stage === 'baseline'
          ? t('standing.stage.baseline')
          : nextInMs === null
            ? interval
            : t('standing.nextIn', { time: formatClock(nextInMs) })
      }
      measuring={reading}
    />
  ) : standingPhase ? (
    <StandingDial
      fraction={Math.min(1, view.standingElapsedMs / STANDING_PHASE_MS)}
      label={t('standing.timerStanding')}
      clock={formatClock(view.standingElapsedMs)}
      caption={
        view.nextReadingAtMs === null
          ? interval
          : t('standing.next', { time: formatClock(view.nextReadingAtMs).replace(/^0/, '') })
      }
      measuring={reading}
    />
  ) : null;

  const inProgress = view.stage !== 'intro' && view.stage !== 'done' && !view.stopped;
  const footer = view.stopped ? (
    <>
      <NavButton label={t('emergency.title')} href="/emergency" />
      <NavButton label={t('standing.sitting')} href="/" variant="secondary" replace />
    </>
  ) : (
    <>
      {view.stage === 'intro' ? (
        <>
          {canRead ? null : (
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
              {t('standing.takeLater')}
            </AppText>
          )}
          <Button label={t('standing.start')} onPress={start} disabled={!canRead} />
        </>
      ) : null}
      {view.dueSlot ? (
        <>
          {readFailed ? (
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
              {t('standing.readFailed')}
            </AppText>
          ) : null}
          <Button label={t('standing.take')} onPress={takeReading} disabled={!canRead || reading} />
        </>
      ) : null}
      {inProgress ? <Button label={t('standing.faint')} onPress={stopForFaint} variant="secondary" /> : null}
      {view.stage === 'done' ? (
        <NavButton label={t('standing.backHome')} href="/" replace />
      ) : (
        <NavButton label={t('standing.stop')} href="/" variant="secondary" replace />
      )}
    </>
  );

  return (
    <Screen footer={footer}>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <AppText variant="headline" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('standing.title')}
        </AppText>

        {view.stage === 'intro' ? null : <StepBar step={view.step} stopped={view.stopped} />}

        <View style={{ gap: spacing.xs }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
              flexWrap: 'wrap',
            }}
          >
            <AppText tone="textDim">{stepText}</AppText>
            <View
              style={{
                backgroundColor: colors.surface2,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              }}
            >
              <AppText variant="caption" style={{ color: colors.accent }}>
                {t('standing.lockChip')}
              </AppText>
            </View>
          </View>
          <AppText variant="title" accessibilityRole="header">
            {heading}
          </AppText>
        </View>

        {view.stage === 'intro' ? (
          <StandingIntro />
        ) : (
          <>
            {dial}
            {reading ? (
              <AppText variant="headline" style={{ textAlign: 'center' }}>
                {t('standing.holdStill')}
              </AppText>
            ) : null}
            {lyingPhase && !view.stopped ? (
              <View style={{ alignItems: 'center' }}>
                <PostureFigure posture="lying" height={FIGURE_HEIGHT} />
              </View>
            ) : null}
            {view.stage === 'standing' || view.stage === 'final' || view.stage === 'done' || view.stopped ? (
              <Card>
                <HeartRateChart
                  points={view.points}
                  baseline={view.baseline}
                  label={t('standing.chartLabel')}
                  lyingLabel={t('standing.chartLying')}
                  nowLabel={t('standing.chartNow')}
                  thresholdLabel={t('standing.threshold')}
                />
              </Card>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Tile
                label={t('standing.lying')}
                value={view.baseline === null ? NO_VALUE : String(view.baseline)}
              />
              <Tile label={t('standing.now')} value={view.latest === null ? NO_VALUE : String(view.latest)} />
              <Tile label={t('standing.rise')} value={formatRise(view.rise)} />
            </View>
            <Card dense>
              <AppText tone="textDim">
                {view.stage === 'done'
                  ? t('standing.doneBody')
                  : view.stopped
                    ? t('standing.scope')
                    : nextReading}
              </AppText>
            </Card>
            <SafetyCard text={view.stopped ? t('standing.faintBody') : t('standing.safety')} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

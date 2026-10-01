import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { DEMO_SPEED, demoClock, readDemoHeartRate } from '@/standing/demo';
import { HeartRateChart } from '@/standing/HeartRateChart';
import { formatClock } from '@/standing/protocol';
import { SafetyCard } from '@/standing/SafetyCard';
import { useStandingTest } from '@/standing/useStandingTest';
import { useTheme } from '@/theme';

const STEP_COUNT = 5;
const NO_VALUE = '—';

function formatRise(rise: number | null): string {
  if (rise === null) return NO_VALUE;
  return rise > 0 ? `+${rise}` : String(rise);
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Card>
        <AppText tone="textDim">{label}</AppText>
        <AppText variant="title">{value}</AppText>
      </Card>
    </View>
  );
}

export default function StandingTestScreen() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  const isDemo = demo === '1';
  const { view, canRead, start, takeReading, stopForFaint } = useStandingTest({
    now: isDemo ? demoClock : Date.now,
    readHeartRate: isDemo ? readDemoHeartRate : null,
  });

  const stageNames = {
    intro: t('standing.stage.intro'),
    lying: t('standing.stage.lying'),
    baseline: t('standing.stage.baseline'),
    standing: t('standing.stage.standing'),
    done: t('standing.stage.done'),
  };
  const headings = {
    intro: t('standing.heading.intro'),
    lying: t('standing.heading.lying'),
    baseline: t('standing.heading.baseline'),
    standing: t('standing.heading.standing'),
    done: t('standing.heading.done'),
  };
  const heading = view.stopped ? t('standing.heading.stopped') : headings[view.stage];

  let timer: { label: string; clock: string } | null = null;
  if (!view.stopped && (view.stage === 'lying' || view.stage === 'baseline')) {
    timer = { label: t('standing.timeLeft'), clock: formatClock(view.lyingRemainingMs) };
  } else if (!view.stopped && view.stage === 'standing') {
    timer = { label: t('standing.timerStanding'), clock: formatClock(view.standingElapsedMs) };
  }

  const interval = t('standing.interval');
  const nextReading =
    view.nextReadingAtMs === null
      ? interval
      : `${t('standing.next', { time: formatClock(view.nextReadingAtMs).replace(/^0/, '') })} ${interval}`;

  const inProgress = view.stage !== 'intro' && view.stage !== 'done' && !view.stopped;
  const footer = view.stopped ? (
    <>
      <NavButton label={t('emergency.title')} href="/emergency" />
      <NavButton label={t('standing.sitting')} href="/" variant="secondary" replace />
    </>
  ) : (
    <>
      {view.stage === 'intro' ? <Button label={t('standing.start')} onPress={start} /> : null}
      {view.dueSlot ? (
        <>
          {canRead ? null : (
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
              {t('standing.takeLater')}
            </AppText>
          )}
          <Button label={t('standing.take')} onPress={takeReading} disabled={!canRead} />
        </>
      ) : null}
      {inProgress ? <Button label={t('standing.faint')} onPress={stopForFaint} variant="secondary" /> : null}
      <NavButton label={t('standing.stop')} href="/" variant="secondary" replace />
    </>
  );

  return (
    <Screen footer={footer}>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <AppText variant="headline" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('standing.title')}
        </AppText>

        {isDemo ? (
          <View
            style={{
              backgroundColor: colors.surface2,
              borderRadius: radius.card,
              padding: spacing.md,
              gap: spacing.xs,
            }}
          >
            <AppText variant="headline">{t('standing.demoBanner')}</AppText>
            <AppText variant="caption" tone="textDim">
              {t('standing.demoNote', { speed: DEMO_SPEED })}
            </AppText>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            flexWrap: 'wrap',
          }}
        >
          <AppText tone="textDim">
            {t('standing.step', { step: view.step, total: STEP_COUNT, stage: stageNames[view.stage] })}
          </AppText>
          <View
            style={{
              backgroundColor: colors.badgeCheckedBg,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            }}
          >
            <AppText variant="caption" style={{ color: colors.badgeCheckedFg }}>
              {t('standing.lockChip')}
            </AppText>
          </View>
        </View>

        <View style={{ alignItems: 'center', gap: spacing.xs }}>
          <AppText variant="display" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {heading}
          </AppText>
          {timer ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <AppText variant="headline" tone="textDim">
                {timer.label}
              </AppText>
              <AppText variant="headline">{timer.clock}</AppText>
            </View>
          ) : null}
        </View>

        {view.stage === 'intro' ? (
          <>
            <SafetyCard text={t('standing.warning')} />
            <Card>
              <AppText>{t('standing.about')}</AppText>
              <AppText tone="textDim">{t('standing.scope')}</AppText>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <HeartRateChart
                points={view.points}
                baseline={view.baseline}
                label={t('standing.chartLabel')}
                lyingLabel={t('standing.chartLying')}
                nowLabel={t('standing.chartNow')}
              />
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Tile
                label={t('standing.lying')}
                value={view.baseline === null ? NO_VALUE : String(view.baseline)}
              />
              <Tile label={t('standing.now')} value={view.latest === null ? NO_VALUE : String(view.latest)} />
              <Tile label={t('standing.rise')} value={formatRise(view.rise)} />
            </View>
            <Card>
              <AppText tone="textDim">{view.stage === 'done' ? t('standing.doneBody') : nextReading}</AppText>
            </Card>
            <SafetyCard text={view.stopped ? t('standing.faintBody') : t('standing.safety')} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

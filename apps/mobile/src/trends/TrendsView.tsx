import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { PressableScale } from '@/components/PressableScale';
import { Reveal, ValueSettle } from '@/components/Reveal';
import { DemoBanner } from '@/results/DemoBanner';
import { readingById } from '@/results/fixtures';
import { formatClock, formatDay } from '@/results/format';
import { LowerQualityTag } from '@/results/LowerQualityTag';
import { rhythmClassWords } from '@/results/rhythmWords';
import { Segmented } from '@/settings/Segmented';
import { useTheme } from '@/theme';

import { learningReadings } from './baseline';
import { CupIcon } from './CupIcon';
import { OtherMetricTile } from './OtherMetricTile';
import { type RhythmDay, RhythmOverTime } from './RhythmOverTime';
import { trendMetrics, trendSeries, type HistoryReading, type TrendMetric, type TrendRange } from './series';
import { TrendChart } from './TrendChart';

const metricIcons: Record<TrendMetric, IconName> = { hr: 'heart', hrv: 'rhythm', resp: 'breath' };

const recentRows = 5;
const rhythmDayCount = 5;
const sparklinePoints = 7;

function metricName(t: TFunction, metric: TrendMetric): string {
  return { hr: t('trends.heartRate'), hrv: t('trends.hrv'), resp: t('trends.breathing') }[metric];
}

function metricUnit(t: TFunction, metric: TrendMetric): string {
  return { hr: t('trends.unitBpm'), hrv: t('trends.unitMs'), resp: t('trends.unitBreaths') }[metric];
}

function metricValue(t: TFunction, metric: TrendMetric, value: number): string {
  const rounded = Math.round(value);
  return {
    hr: t('results.bpm', { value: rounded }),
    hrv: t('results.ms', { value: rounded }),
    resp: t('trends.breathsPerMin', { value: rounded }),
  }[metric];
}

type TrendsViewProps = {
  readings: readonly HistoryReading[];
  // The range buttons count back from here.
  now: Date;
  // Sample history carries the Demo banner (§8.5) and is never called "Today".
  demo: boolean;
};

export function TrendsView({ readings, now, demo }: TrendsViewProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const [range, setRange] = useState<TrendRange>('30d');
  const [metric, setMetric] = useState<TrendMetric>('hr');
  const series = trendSeries(readings, metric, range, now);
  const { points, lowerPoints } = series;
  const isToday = (moment: Date) => !demo && moment.toDateString() === now.toDateString();
  const dayLabel = (moment: Date) => (isToday(moment) ? t('trends.today') : formatDay(moment, i18n.language));
  const flaggedById = new Map(series.flaggedLowRhythms.map((flagged) => [flagged.id, flagged.rhythm]));
  // A flagged lower-quality rhythm on a reading with no value for this metric has nothing to plot, but its row
  // stays so Trends agrees with Results and Home.
  const shownIds = new Set([...points, ...lowerPoints].map((point) => point.id));
  const rows = [
    ...points.map((point) => ({
      ...point,
      lowerValue: false,
      flaggedLow: flaggedById.get(point.id) ?? null,
    })),
    ...lowerPoints.map((point) => ({
      ...point,
      lowerValue: true,
      flaggedLow: flaggedById.get(point.id) ?? null,
    })),
    ...series.flaggedLowRhythms
      .filter((flagged) => !shownIds.has(flagged.id))
      .map(({ id, createdAt, rhythm }) => ({
        id,
        createdAt,
        value: null,
        lowerValue: false,
        caffeine: false,
        rhythm: null,
        reasons: [],
        flaggedLow: rhythm,
      })),
  ].sort((earlier, later) => earlier.createdAt.getTime() - later.createdAt.getTime());
  const plotted = [...points, ...lowerPoints].sort(
    (earlier, later) => earlier.createdAt.getTime() - later.createdAt.getTime(),
  );
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const intervalsById = new Map(readings.map((reading) => [reading.id, reading.intervalsMs]));
  const rhythmDays: RhythmDay[] = rows
    .filter((row) => row.rhythm !== null || row.flaggedLow !== null)
    .slice(-rhythmDayCount)
    .reverse()
    .map((row) => ({
      id: row.id,
      day: dayLabel(row.createdAt),
      rhythm: row.rhythm ?? row.flaggedLow,
      lowerQuality: row.flaggedLow !== null,
      intervalsMs: intervalsById.get(row.id) ?? [],
    }));
  const otherMetrics = trendMetrics.filter((other) => other !== metric);
  const nextMetric = trendMetrics[(trendMetrics.indexOf(metric) + 1) % trendMetrics.length]!;
  const middle = first && last ? new Date((first.createdAt.getTime() + last.createdAt.getTime()) / 2) : null;

  return (
    <>
      {demo ? (
        <Reveal>
          <DemoBanner synthetic={false} />
          <AppText variant="caption" tone="textDim">
            {t('trends.demoNote')}
          </AppText>
        </Reveal>
      ) : null}
      {readings.length === 0 ? (
        <Reveal>
          <Card>
            <AppText variant="headline">{t('trends.emptyTitle')}</AppText>
            <AppText tone="textDim">{t('trends.emptyBody')}</AppText>
          </Card>
        </Reveal>
      ) : (
        <>
          <Segmented
            options={[
              { value: '7d', label: t('trends.range7') },
              { value: '30d', label: t('trends.range30') },
              { value: '90d', label: t('trends.range90') },
            ]}
            selected={range}
            onSelect={setRange}
          />
          <ValueSettle value={`${metric}-${range}`}>
            <Card>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('trends.metricSwitch', {
                  metric: metricName(t, metric),
                  next: metricName(t, nextMetric),
                })}
                onPress={() => setMetric(nextMetric)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  alignSelf: 'flex-start',
                }}
              >
                <AppText variant="headline" tone="accent" accessibilityRole="header">
                  {metricName(t, metric)}
                </AppText>
                <Icon name="chevron" size={14} color={colors.accent} />
              </PressableScale>
              <View
                accessible
                accessibilityLabel={`${t('trends.median')}: ${
                  series.median === null ? '—' : metricValue(t, metric, series.median)
                }`}
              >
                <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
                  {t('trends.median')}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
                  <AppText variant="vitalL">
                    {series.median === null ? '—' : String(Math.round(series.median))}
                  </AppText>
                  {series.median === null ? null : (
                    <AppText tone="textDim" style={{ fontWeight: '500' }}>
                      {metricUnit(t, metric)}
                    </AppText>
                  )}
                </View>
              </View>
              {first && last ? (
                <>
                  <AppText variant="caption" tone="textDim">
                    {t('trends.dateSpan', { from: dayLabel(first.createdAt), to: dayLabel(last.createdAt) })}
                  </AppText>
                  <TrendChart
                    points={points}
                    lowerPoints={lowerPoints}
                    band={series.band}
                    label={t('trends.chartLabel', { metric: metricName(t, metric), count: plotted.length })}
                    firstLabel={dayLabel(first.createdAt)}
                    middleLabel={middle && plotted.length > 2 ? dayLabel(middle) : null}
                    lastLabel={dayLabel(last.createdAt)}
                  />
                </>
              ) : (
                <AppText tone="textDim">{t('trends.noneInRange')}</AppText>
              )}
              {series.band ? (
                <AppText variant="caption" tone="textDim">
                  {t('trends.bandLine', {
                    low: Math.round(series.band.low),
                    high: Math.round(series.band.high),
                    unit: metricUnit(t, metric),
                    count: points.length,
                  })}
                </AppText>
              ) : series.baselineCount > 0 ? (
                <AppText variant="caption" tone="textDim">
                  {t('trends.learning', { count: series.baselineCount, total: learningReadings })}
                </AppText>
              ) : null}
              {lowerPoints.length > 0 ? (
                <AppText variant="caption" tone="textDim">
                  {t('trends.lowerLegend')}
                </AppText>
              ) : null}
            </Card>
          </ValueSettle>
          {rows.length > 0 ? (
            <Reveal style={{ gap: spacing.sm }}>
              <AppText variant="caption" tone="textDim" style={{ paddingHorizontal: spacing.lg }}>
                {t('trends.recent')}
              </AppText>
              <Card flush>
                {rows
                  .slice(-recentRows)
                  .reverse()
                  .map((point, index, shown) => {
                    const word = point.flaggedLow
                      ? t('quality.marked', { value: rhythmClassWords(t, point.flaggedLow).value })
                      : point.rhythm
                        ? rhythmClassWords(t, point.rhythm).value
                        : undefined;
                    // Saved readings always open. Sample rows open only when a fixture has that id.
                    const fixture = demo ? readingById(point.id) : undefined;
                    const opens = !demo || fixture !== undefined;
                    const clock = formatClock(point.createdAt, i18n.language);
                    const when = isToday(point.createdAt)
                      ? t('trends.todayAt', { time: clock })
                      : t('results.dayAt', { day: formatDay(point.createdAt, i18n.language), time: clock });
                    return (
                      <ListRow
                        key={point.id}
                        title={when}
                        subtitle={word}
                        last={index === shown.length - 1}
                        chevron={opens}
                        onPress={opens ? () => router.push(`/results/${point.id}`) : undefined}
                        trailing={
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                            {fixture?.synthetic ? <SyntheticTag /> : null}
                            {point.lowerValue ? <LowerQualityTag small reasons={point.reasons} /> : null}
                            {point.caffeine ? <CupIcon size={16} color={colors.flag} /> : null}
                            {point.value === null ? null : (
                              <AppText variant="headline">
                                {Math.round(point.value)}
                                <AppText variant="subheadline" tone="textDim" style={{ fontWeight: '500' }}>
                                  {` ${metricUnit(t, metric)}`}
                                </AppText>
                              </AppText>
                            )}
                          </View>
                        }
                      />
                    );
                  })}
              </Card>
            </Reveal>
          ) : null}
          {rhythmDays.length > 0 ? (
            <Reveal>
              <RhythmOverTime days={rhythmDays} />
            </Reveal>
          ) : null}
          <Reveal style={{ gap: spacing.md }}>
            {otherMetrics.map((other) => {
              const otherSeries = trendSeries(readings, other, range, now);
              const latest = otherSeries.points[otherSeries.points.length - 1];
              return (
                <OtherMetricTile
                  key={other}
                  name={metricName(t, other)}
                  icon={metricIcons[other]}
                  band={otherSeries.band}
                  unit={metricUnit(t, other)}
                  value={latest ? Math.round(latest.value) : null}
                  when={latest ? dayLabel(latest.createdAt) : null}
                  sparkline={otherSeries.points.slice(-sparklinePoints).map((point) => point.value)}
                  onPress={() => setMetric(other)}
                />
              );
            })}
          </Reveal>
        </>
      )}
    </>
  );
}

// §8.5: a hand-written reading is never passed off as a recorded one, here or on its own screens.
function SyntheticTag() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.badgeExperimentalBg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs / 2,
      }}
    >
      <AppText variant="caption" style={{ color: colors.badgeExperimentalFg }}>
        {t('trends.synthetic')}
      </AppText>
    </View>
  );
}

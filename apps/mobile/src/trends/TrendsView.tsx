import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { ListRow } from '@/components/ListRow';
import { DemoBanner } from '@/results/DemoBanner';
import { readingById } from '@/results/fixtures';
import { formatClock, formatDay } from '@/results/format';
import { Segmented } from '@/settings/Segmented';
import { useTheme } from '@/theme';

import { learningReadings } from './baseline';
import { CupIcon } from './CupIcon';
import { MetricChips } from './MetricChips';
import {
  evidenceOf,
  trendMetrics,
  trendSeries,
  type HistoryReading,
  type TrendMetric,
  type TrendPoint,
  type TrendRange,
} from './series';
import { TrendChart } from './TrendChart';

const recentRows = 5;

function metricName(t: TFunction, metric: TrendMetric): string {
  return { hr: t('trends.restingHr'), hrv: t('trends.hrv'), resp: t('trends.breathing') }[metric];
}

function metricValue(t: TFunction, metric: TrendMetric, value: number): string {
  const rounded = Math.round(value);
  return {
    hr: t('results.bpm', { value: rounded }),
    hrv: t('results.ms', { value: rounded }),
    resp: t('trends.breathsPerMin', { value: rounded }),
  }[metric];
}

function rhythmWord(t: TFunction, rhythm: TrendPoint['rhythm']): string | null {
  if (rhythm === 'sinus') return t('results.rhythmRegular');
  if (rhythm === 'af') return t('results.rhythmIrregular');
  if (rhythm === 'other') return t('results.rhythmOther');
  return null;
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
  const { points } = series;
  const isToday = (moment: Date) => !demo && moment.toDateString() === now.toDateString();
  const dayLabel = (moment: Date) => (isToday(moment) ? t('trends.today') : formatDay(moment, i18n.language));
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <>
      {demo ? (
        <>
          <DemoBanner synthetic={false} />
          <AppText variant="caption" tone="textDim">
            {t('trends.demoNote')}
          </AppText>
        </>
      ) : null}
      {readings.length === 0 ? (
        <Card>
          <AppText variant="headline">{t('trends.emptyTitle')}</AppText>
          <AppText tone="textDim">{t('trends.emptyBody')}</AppText>
        </Card>
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
          <MetricChips
            options={trendMetrics.map((value) => ({ value, label: metricName(t, value) }))}
            selected={metric}
            onSelect={setMetric}
          />
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText variant="headline">{metricName(t, metric)}</AppText>
              <EvidenceBadge metric={evidenceOf[metric]} />
            </View>
            {first && last ? (
              <TrendChart
                points={points}
                band={series.band}
                label={t('trends.chartLabel', { metric: metricName(t, metric), count: points.length })}
                firstLabel={dayLabel(first.createdAt)}
                lastLabel={dayLabel(last.createdAt)}
              />
            ) : (
              <AppText tone="textDim">{t('trends.noneInRange')}</AppText>
            )}
            {points.length > 0 && !series.band ? (
              <AppText variant="caption" tone="textDim">
                {t('trends.learning', { count: points.length, total: learningReadings })}
              </AppText>
            ) : null}
          </Card>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Tile
              title={t('trends.median')}
              value={series.median === null ? '—' : metricValue(t, metric, series.median)}
            />
            <Tile
              title={t('trends.band')}
              value={series.band ? `${Math.round(series.band.low)}–${Math.round(series.band.high)}` : '—'}
            />
            <Tile title={t('trends.readings')} value={String(points.length)} />
          </View>
          {points.length > 0 ? (
            <Card flush>
              {points
                .slice(-recentRows)
                .reverse()
                .map((point, index, shown) => {
                  const word = rhythmWord(t, point.rhythm);
                  const value = metricValue(t, metric, point.value);
                  // A row opens a reading only when that reading exists; sample rows have no Results screen.
                  const opens = readingById(point.id) !== undefined;
                  const clock = formatClock(point.createdAt, i18n.language);
                  const when = isToday(point.createdAt)
                    ? t('trends.todayAt', { time: clock })
                    : t('results.dayAt', { day: formatDay(point.createdAt, i18n.language), time: clock });
                  return (
                    <ListRow
                      key={point.id}
                      title={when}
                      last={index === shown.length - 1}
                      chevron={opens}
                      onPress={opens ? () => router.push(`/results/${point.id}`) : undefined}
                      trailing={
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                          {point.caffeine ? <CupIcon size={16} color={colors.flag} /> : null}
                          <AppText tone="textDim">{word ? `${value} · ${word}` : value}</AppText>
                        </View>
                      }
                    />
                  );
                })}
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

function Tile({ title, value }: { title: string; value: string }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${value}`}
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <AppText variant="caption" tone="textDim">
        {title}
      </AppText>
      <AppText variant="headline">{value}</AppText>
    </View>
  );
}

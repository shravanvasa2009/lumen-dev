import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

import { BeatStrip } from './BeatStrip';
import { DemoBanner } from './DemoBanner';
import type { FixtureReading } from './fixtures';
import { medianIntervalMs } from './poincare';
import { BEAT_WINDOW_GAPS } from './WhyReading';

// Steps through the reading's beat gaps a few at a time. There is no sliding handle: two buttons move the window,
// which works the same with a screen reader and on a small phone.
export function BeatByBeatView({ reading }: { reading: FixtureReading }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const gaps = reading.intervalsMs;
  const lastStart = Math.max(0, gaps.length - BEAT_WINDOW_GAPS);
  const [start, setStart] = useState(0);
  const shown = gaps.slice(start, start + BEAT_WINDOW_GAPS);
  const median = medianIntervalMs(gaps);
  const closest =
    median === null
      ? null
      : gaps.reduce((best, gap) => (Math.abs(gap - median) < Math.abs(best - median) ? gap : best));
  const seriesColor = reading.scan.metrics.rhythm?.flag ? colors.flag : colors.accent;
  const rejected = reading.scan.rejectedBeats;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('why.beatByBeat') }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xxl, paddingBottom: spacing.lg }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <View style={{ gap: spacing.md }}>
          <AppText variant="title3" accessibilityRole="header">
            {t('why.seeBeats')}
          </AppText>
          <Card>
            <AppText variant="subheadline" tone="textDim">
              {t('why.beatRange', { from: start + 1, to: start + shown.length, total: gaps.length })}
            </AppText>
            {shown.length > 0 ? <BeatStrip intervalsMs={shown} color={seriesColor} /> : null}
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="tint"
                  label={t('why.earlier')}
                  disabled={start === 0}
                  onPress={() => setStart(Math.max(0, start - BEAT_WINDOW_GAPS))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="tint"
                  label={t('why.later')}
                  disabled={start >= lastStart}
                  onPress={() => setStart(Math.min(lastStart, start + BEAT_WINDOW_GAPS))}
                />
              </View>
            </View>
            {rejected > 0 ? (
              <AppText variant="subheadline" tone="textDim">
                {t('why.beatsUsed', { used: reading.scan.beats, total: reading.scan.beats + rejected })}
              </AppText>
            ) : null}
          </Card>
        </View>
        {closest !== null ? (
          <View style={{ gap: spacing.md }}>
            <AppText variant="title3" accessibilityRole="header">
              {t('why.oneBeat')}
            </AppText>
            <Card>
              <BeatStrip intervalsMs={[closest]} color={seriesColor} />
              <AppText tone="textDim">
                {t('why.oneBeatNote', { gap: Math.round(closest), bpm: Math.round(60000 / closest) })}
              </AppText>
            </Card>
          </View>
        ) : null}
        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('prototype.banner')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

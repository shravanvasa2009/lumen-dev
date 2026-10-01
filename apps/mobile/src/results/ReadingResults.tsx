import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { RhythmMetric } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Screen } from '@/components/Screen';
import { evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { ExperimentalCard } from './ExperimentalCard';
import type { FixtureReading } from './fixtures';
import { formatClock, formatDay, isSameDay } from './format';
import { Glyph } from './Glyph';
import { MetricCard } from './MetricCard';
import { SafetySheet } from './SafetySheet';

function headlineText(t: TFunction, reading: FixtureReading): string {
  const { headlineKey, metrics } = reading.scan;
  switch (headlineKey) {
    case 'result.regular':
      return metrics.hr ? t('result.regular', { hr: metrics.hr.value }) : t('result.inconclusive');
    case 'result.irregularRetake':
      return t('results.headlineIrregular');
    case 'result.possibleAf':
      return t('result.possibleAf');
    case 'result.uncertain':
      return t('result.uncertain');
    case 'result.inconclusive':
      return t('result.inconclusive');
  }
}

function sublineText(t: TFunction, reading: FixtureReading, anyFlag: boolean): string | null {
  const { headlineKey } = reading.scan;
  if (headlineKey === 'result.regular')
    return anyFlag ? t('results.sublineFollowUp') : t('results.sublineUsual');
  if (headlineKey === 'result.irregularRetake' && reading.repeat)
    return t('results.sublineRetake', { remaining: reading.repeat.of - reading.repeat.number });
  return null;
}

function rhythmWords(t: TFunction, rhythm: RhythmMetric): { value: string; note: string } {
  if (rhythm.class === 'sinus') return { value: t('results.rhythmRegular'), note: t('results.noteRegular') };
  if (rhythm.class === 'af') return { value: t('results.rhythmIrregular'), note: t('results.noteIrregular') };
  return { value: t('results.rhythmOther'), note: t('results.noteOther') };
}

export function ReadingResults({ reading }: { reading: FixtureReading }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const scan = reading.scan;
  const { hr, rhythm, rmssd, diabetes } = scan.metrics;
  const acuteFlag = Boolean(hr?.flag) || Boolean(rhythm?.flag);
  const [sheetOpen, setSheetOpen] = useState(acuteFlag);

  // ADR 0046: the amber card needs the flag and a passed accuracy criterion; otherwise the estimate
  // sits in Experimental measurements.
  const diabetesCard = diabetes?.flag === 'pattern' && evidenceFor('diabetes').measured ? diabetes : null;
  const diabetesExperimental = diabetes !== null && diabetesCard === null;
  const anyFlag = acuteFlag || diabetesCard !== null;

  const subline = sublineText(t, reading, anyFlag);
  const clock = formatClock(reading.createdAt, i18n.language);
  const when = isSameDay(reading.createdAt, new Date())
    ? t('results.todayAt', { time: clock })
    : t('results.dayAt', { day: formatDay(reading.createdAt, i18n.language), time: clock });
  // A repeat counter already says when in the day this reading was taken, so the time drops out.
  const metaParts = [
    reading.repeat ? t('results.readingOf', { number: reading.repeat.number, of: reading.repeat.of }) : null,
    reading.mode === 'full' ? t('mode.full') : t('mode.quick'),
    t('results.cleanSeconds', { seconds: scan.cleanSeconds }),
    reading.repeat ? null : when,
  ].filter((part) => part !== null);

  const headlineTone = acuteFlag
    ? { fill: colors.flagBg, edge: colors.flag }
    : { fill: colors.badgeCheckedBg, edge: colors.accent };

  return (
    <Screen
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t('results.showWhy')}
              variant="secondary"
              onPress={() => router.push(`/results/${reading.id}/why`)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('results.share')} onPress={() => router.push(`/report/${reading.id}`)} />
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title" accessibilityRole="header">
            {t('results.title')}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('results.shareResult')}
            hitSlop={spacing.md}
            onPress={() => router.push(`/report/${reading.id}`)}
          >
            <Glyph name="share" size={24} color={colors.accent} />
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: headlineTone.fill,
            borderColor: headlineTone.edge,
            borderWidth: 1,
            borderRadius: radius.card,
            padding: spacing.lg,
            gap: spacing.xs,
          }}
        >
          <AppText variant="title">{headlineText(t, reading)}</AppText>
          {subline ? <AppText>{subline}</AppText> : null}
          <AppText variant="caption" tone="textDim">
            {metaParts.join(' · ')}
          </AppText>
        </View>

        {diabetesCard ? (
          <View
            style={{
              backgroundColor: colors.flagBg,
              borderColor: colors.flag,
              borderWidth: 1,
              borderRadius: radius.card,
              padding: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText variant="headline" style={{ color: colors.flag, flex: 1 }}>
                {t('results.diabetesTitle')}
              </AppText>
              <EvidenceBadge metric="diabetes" />
            </View>
            <AppText>
              {t('results.diabetesSeen', {
                readings: diabetesCard.readingsUsed,
                days: reading.diabetesDays.map((day) => formatDay(day, i18n.language)).join(', '),
              })}
            </AppText>
            <AppText
              accessibilityRole="link"
              tone="accent"
              onPress={() => router.push('/learn/diabetes-and-your-pulse')}
            >
              {t('results.diabetesNext')} ›
            </AppText>
          </View>
        ) : null}

        <MetricCard
          title={t('results.heartRhythm')}
          evidenceMetric="rhythm"
          reading={
            rhythm && {
              ...rhythmWords(t, rhythm),
              confidence: rhythm.confidence,
              flagged: rhythm.flag !== null,
            }
          }
        />
        <MetricCard
          title={t('results.heartRate')}
          evidenceMetric="hr"
          reading={
            hr && {
              value: t('results.bpm', { value: hr.value }),
              note: t('results.noteResting'),
              confidence: hr.confidence,
              flagged: hr.flag !== null,
            }
          }
        />
        {reading.mode === 'full' ? (
          <MetricCard
            title={t('results.hrv')}
            evidenceMetric="hrv"
            reading={
              rmssd && {
                value: t('results.ms', { value: rmssd.value }),
                note: rmssd.band
                  ? t('results.yourBand', { low: rmssd.band[0], high: rmssd.band[1] })
                  : t('results.learningBand'),
                confidence: rmssd.confidence,
                flagged: false,
              }
            }
          />
        ) : null}

        <ExperimentalCard experimental={scan.experimental} showDiabetes={diabetesExperimental} />

        <AppText tone="textDim">
          {t('result.notChecked')}{' '}
          <AppText accessibilityRole="link" tone="accent" onPress={() => router.push('/settings/accuracy')}>
            {t('results.accuracy')} ›
          </AppText>
        </AppText>
      </ScrollView>
      <SafetySheet visible={sheetOpen} onDismiss={() => setSheetOpen(false)} />
    </Screen>
  );
}

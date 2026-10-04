import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Screen } from '@/components/Screen';
import { evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { CompactChecks } from './CompactChecks';
import { DemoBanner } from './DemoBanner';
import { DiabetesCheckCard } from './DiabetesCheckCard';
import { ExperimentalCard } from './ExperimentalCard';
import type { FixtureReading } from './fixtures';
import { formatClock, formatDay } from './format';
import { HeadlineCard } from './HeadlineCard';
import { Icon } from '@/components/Icon';
import { MetricCard } from './MetricCard';
import { PotsCard } from './PotsCard';
import { rhythmWords } from './rhythmWords';
import { SafetySheet } from './SafetySheet';

const NARROW_WIDTH = 400;
const LARGE_TEXT_SCALE = 1.3;

function headlineText(t: TFunction, reading: FixtureReading): string {
  const { headlineKey, metrics } = reading.scan;
  switch (headlineKey) {
    case 'result.regular':
      return metrics.hr ? t('result.regular', { hr: metrics.hr.value }) : t('result.inconclusive');
    case 'result.irregularRetake':
      return t('result.irregularRetake');
    case 'result.possibleAf':
      return t('result.possibleAf');
    case 'result.uncertain':
      return t('result.uncertain');
    case 'result.inconclusive':
      return t('result.inconclusive');
  }
}

function sublineText(t: TFunction, reading: FixtureReading, anyFlag: boolean): string | null {
  const { headlineKey, metrics } = reading.scan;
  if (headlineKey === 'result.regular') {
    if (anyFlag) return t('results.sublineFollowUp');
    // "Usual range" is only true when there is a personal band to compare against.
    return metrics.rmssd?.band ? t('results.sublineUsual') : t('results.sublineNeutral');
  }
  if (headlineKey === 'result.irregularRetake' && reading.repeat)
    return t('results.sublineRetake', { remaining: reading.repeat.of - reading.repeat.number });
  return null;
}

export function ReadingResults({ reading }: { reading: FixtureReading }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  // Side by side the labels wrap on a 360 dp phone or at large text, so the buttons stack there instead.
  const { width, fontScale } = useWindowDimensions();
  const stackFooter = width < NARROW_WIDTH || fontScale > LARGE_TEXT_SCALE;
  const scan = reading.scan;
  const { hr, rhythm, rmssd, diabetes } = scan.metrics;
  const acuteFlag = Boolean(hr?.flag) || Boolean(rhythm?.flag);

  // ADR 0046, §12.5: the amber card needs the flag and a passed accuracy criterion. Without the passed
  // criterion the estimate gets the quiet Experimental card (ADR 0082); with it and no flag, nothing is shown.
  const diabetesCard = diabetes?.flag === 'pattern' && evidenceFor('diabetes').measured ? diabetes : null;
  const diabetesExperimental = diabetes !== null && !evidenceFor('diabetes').measured;
  const anyFlag = acuteFlag || diabetesCard !== null;
  const [sheetOpen, setSheetOpen] = useState(anyFlag);

  const subline = sublineText(t, reading, anyFlag);
  const when = t('results.dayAt', {
    day: formatDay(reading.createdAt, i18n.language),
    time: formatClock(reading.createdAt, i18n.language),
  });
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
        <View testID="results-footer" style={{ flexDirection: stackFooter ? 'column' : 'row', gap: spacing.md }}>
          <View style={stackFooter ? undefined : { flex: 1 }}>
            <Button
              label={t('results.showWhy')}
              variant="secondary"
              onPress={() => router.push(`/results/${reading.id}/why`)}
            />
          </View>
          <View style={stackFooter ? undefined : { flex: 1 }}>
            <Button label={t('results.share')} onPress={() => router.push(`/report/${reading.id}`)} />
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
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
            <Icon name="share" size={24} color={colors.accent} />
          </Pressable>
        </View>

        <HeadlineCard fill={headlineTone.fill} edge={headlineTone.edge}>
          <AppText variant="title">{headlineText(t, reading)}</AppText>
          {subline ? <AppText>{subline}</AppText> : null}
          <AppText variant="caption" tone="textDim">
            {metaParts.join(' · ')}
          </AppText>
        </HeadlineCard>

        {acuteFlag ? <Button label={t('results.findCare')} onPress={() => router.push('/care')} /> : null}

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
                {t('dm.flag.title')}
              </AppText>
              <EvidenceBadge metric="diabetes" />
            </View>
            <AppText>
              {t('results.diabetesSeen', {
                readings: diabetesCard.readingsUsed,
                days: reading.diabetesDays.map((day) => formatDay(day, i18n.language)).join(', '),
              })}
            </AppText>
            <AppText>{t('dm.flag.body')}</AppText>
            <AppText
              accessibilityRole="link"
              tone="accent"
              onPress={() => router.push('/learn/diabetes-and-your-pulse')}
            >
              {t('results.diabetesNext')} ›
            </AppText>
            <Button label={t('results.findCare')} onPress={() => router.push('/care')} />
          </View>
        ) : null}

        <MetricCard
          title={t('results.heartRhythm')}
          checkName={t('checks.afib.name')}
          icon="pulse"
          evidenceMetric="rhythm"
          reading={
            rhythm && {
              ...rhythmWords(t, rhythm),
              confidence: rhythm.confidence,
              flagged: rhythm.flag !== null,
            }
          }
        />
        {reading.mode === 'full' ? (
          <MetricCard
            title={t('results.hrv')}
            icon="bars"
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

        {reading.mode !== 'full' ? <CompactChecks /> : null}
        {diabetesExperimental ? <DiabetesCheckCard /> : null}
        {reading.mode === 'full' ? <PotsCard /> : null}

        <MetricCard
          title={t('results.heartRate')}
          icon="heart"
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

        <ExperimentalCard experimental={scan.experimental} />

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

import { Stack, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { ReadingResult } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Reveal } from '@/components/Reveal';
import { Screen } from '@/components/Screen';
import { evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { DemoBanner } from './DemoBanner';
import { showsPulseExtra } from './DiabetesCheckCard';
import { DiabetesRiskRow, PulseExtraRow } from './DiabetesRiskRow';
import { ExperimentalCard } from './ExperimentalCard';
import type { FixtureReading } from './fixtures';
import { formatClock, formatDay } from './format';
import { HeadlineCard } from './HeadlineCard';
import { Icon } from '@/components/Icon';
import { MetricCard } from './MetricCard';
import { PotsCard } from './PotsCard';
import { isLowQuality, missingReasonText, metricReasons, readingQuality } from './quality';
import { LowerQualityTag } from './LowerQualityTag';
import { rhythmWords } from './rhythmWords';
import { SafetySheet } from './SafetySheet';
import { clearSymptomsAsked, symptomsAskedFor } from './symptomsAsked';

const NARROW_WIDTH = 400;
const LARGE_TEXT_SCALE = 1.3;

function headlineText(t: TFunction, reading: FixtureReading): string {
  const { headlineKey, metrics } = reading.scan;
  switch (headlineKey) {
    case 'result.regular':
      return metrics.hr
        ? t('result.regular', { hr: Math.round(metrics.hr.value) })
        : t('result.inconclusive');
    case 'result.irregularRetake':
      return t('result.irregularRetake');
    case 'result.possibleAf':
      return t('result.possibleAf');
    case 'result.uncertain':
      return t('result.uncertain');
    case 'result.hrOnly':
      return t('result.hrOnly');
    case 'result.inconclusive':
      return t('result.inconclusive');
  }
}

function sublineText(t: TFunction, reading: FixtureReading, anyFlag: boolean): string | null {
  const { headlineKey, metrics } = reading.scan;
  if (headlineKey === 'result.regular' || headlineKey === 'result.hrOnly') {
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
  const { hr, rhythm, rmssd, resp, diabetes } = scan.metrics;
  const quality = readingQuality(scan);
  const lowReasons = (metric: object | null) => metricReasons(metric, quality);
  // Null when the cause is the signal itself, which keeps "Not enough clean signal".
  const knownMissing = missingReasonText(t, quality.reasons) ?? undefined;
  const hrFlag = Boolean(hr?.flag);
  const rhythmFlag = Boolean(rhythm?.flag);
  const acuteFlag = hrFlag || rhythmFlag;
  // Owner 2026-10-09 (ADR 0104 answer c): a flag on a lower-quality value is shown, not hidden, just quieter.
  // The safety sheet and the emergency screen still follow acuteFlag.
  const hrQuiet = hrFlag && isLowQuality(hr);
  const rhythmQuiet = rhythmFlag && isLowQuality(rhythm);
  const flagDeprioritized = acuteFlag && (!hrFlag || hrQuiet) && (!rhythmFlag || rhythmQuiet);
  // Owner 2026-10-06 (ADR 0104 answer 2): a short reading's rate under 40 or over 150 bpm. Not the Emergency
  // screen; readings saved before the field have none.
  const retake = (scan.retakePrompt as ReadingResult['retakePrompt'] | undefined) ?? null;

  // ADR 0046, §12.5: the amber card needs the flag and a passed accuracy criterion. Without the passed
  // criterion the estimate gets the quiet Experimental card (ADR 0082); with it and no flag, nothing is shown.
  const diabetesCard = diabetes?.flag === 'pattern' && evidenceFor('diabetes').measured ? diabetes : null;
  const anyFlag = acuteFlag || diabetesCard !== null;
  // Processing already asked the question for this reading just now; a reading opened later asks again.
  const [sheetOpen, setSheetOpen] = useState(anyFlag && !symptomsAskedFor(reading.id));
  useEffect(() => clearSymptomsAsked(reading.id), [reading.id]);

  const hrvMissingText = !rhythm?.class
    ? t('quality.missingNoRhythm')
    : rhythm.class !== 'sinus'
      ? t('quality.missingNotSinus')
      : undefined;
  const subline = sublineText(t, reading, anyFlag);
  const when = t('results.dayAt', {
    day: formatDay(reading.createdAt, i18n.language),
    time: formatClock(reading.createdAt, i18n.language),
  });
  // A repeat counter already says when in the day this reading was taken, so the time drops out.
  const metaParts = [
    reading.repeat ? t('results.readingOf', { number: reading.repeat.number, of: reading.repeat.of }) : null,
    reading.mode === 'full' ? t('mode.full') : t('mode.quick'),
    t('results.cleanSeconds', { seconds: Math.floor(scan.cleanSeconds) }),
    reading.repeat ? null : when,
  ].filter((part) => part !== null);

  const headlineTone =
    acuteFlag && !flagDeprioritized
      ? { fill: colors.flagBg, edge: colors.flag }
      : { fill: colors.badgeCheckedBg, edge: colors.accent };

  const findCareButton = <Button label={t('results.findCare')} onPress={() => router.push('/care')} />;
  const cards: { key: string; low: boolean; node: ReactNode }[] = [
    {
      key: 'rhythm',
      low: isLowQuality(rhythm),
      node: (
        <MetricCard
          title={t('results.heartRhythm')}
          checkName={t('checks.afib.name')}
          icon="pulse"
          evidenceMetric="rhythm"
          basicAnalysis={rhythm?.scorer === 'rule'}
          missingText={knownMissing}
          lowQualityReasons={lowReasons(rhythm)}
          footnote={rhythm?.flag !== null && lowReasons(rhythm) ? t('quality.confirmAf') : undefined}
          quietFlag={rhythmQuiet}
          reading={
            rhythm && {
              ...rhythmWords(t, rhythm),
              confidence: rhythm.confidence,
              flagged: rhythm.flag !== null,
            }
          }
        />
      ),
    },
    {
      key: 'hrv',
      low: isLowQuality(rmssd),
      node: (
        <MetricCard
          title={t('results.hrv')}
          icon="bars"
          evidenceMetric="hrv"
          missingText={hrvMissingText ?? knownMissing}
          lowQualityReasons={lowReasons(rmssd)}
          reading={
            rmssd && {
              value: t('results.ms', { value: Math.round(rmssd.value) }),
              note: rmssd.band
                ? t('results.yourBand', { low: Math.round(rmssd.band[0]), high: Math.round(rmssd.band[1]) })
                : t('results.learningBand'),
              confidence: rmssd.confidence,
              flagged: false,
            }
          }
        />
      ),
    },
    {
      key: 'resp',
      low: isLowQuality(resp),
      node: (
        <MetricCard
          title={t('results.breathing')}
          icon="breath"
          evidenceMetric="resp"
          missingText={knownMissing}
          lowQualityReasons={lowReasons(resp)}
          reading={
            resp && {
              value: t('results.brpm', { value: Math.round(resp.value) }),
              note: t('results.noteResting'),
              confidence: resp.confidence,
              flagged: false,
            }
          }
        />
      ),
    },
    {
      key: 'extras',
      low: false,
      node: (
        <>
          <DiabetesRiskRow readingId={reading.id} sample={reading.sample} />
          {showsPulseExtra(reading) && lowReasons(diabetes) ? (
            <LowerQualityTag small reasons={lowReasons(diabetes) ?? []} />
          ) : null}
          {showsPulseExtra(reading) ? <PulseExtraRow readingId={reading.id} /> : null}
          <PotsCard />
        </>
      ),
    },
    {
      key: 'hr',
      low: isLowQuality(hr),
      node: (
        <MetricCard
          title={t('results.heartRate')}
          icon="heart"
          evidenceMetric="hr"
          missingText={knownMissing}
          lowQualityReasons={lowReasons(hr)}
          quietFlag={hrQuiet}
          reading={
            hr && {
              value: t('results.bpm', { value: Math.round(hr.value) }),
              note: t('results.noteResting'),
              confidence: hr.confidence,
              flagged: hr.flag !== null,
            }
          }
        />
      ),
    },
  ];
  // Array.sort is stable, so the usual order holds inside each group. Only a quiet flag reorders the screen.
  const orderedCards = flagDeprioritized ? [...cards].sort((a, b) => Number(a.low) - Number(b.low)) : cards;

  return (
    <Screen
      footer={
        <View
          testID="results-footer"
          style={{ flexDirection: stackFooter ? 'column' : 'row', gap: spacing.md }}
        >
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
      <Stack.Screen
        options={{
          title: t('results.title'),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('results.shareResult')}
              hitSlop={spacing.md}
              onPress={() => router.push(`/report/${reading.id}`)}
            >
              <Icon name="share" size={24} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <Reveal>
          <HeadlineCard fill={headlineTone.fill} edge={headlineTone.edge}>
            {flagDeprioritized ? (
              <>
                <AppText variant="title">{t('results.lowQualityLead')}</AppText>
                <AppText variant="headline">{headlineText(t, reading)}</AppText>
              </>
            ) : (
              <AppText variant="title">{headlineText(t, reading)}</AppText>
            )}
            {subline ? <AppText>{subline}</AppText> : null}
            <AppText variant="caption" tone="textDim">
              {metaParts.join(' · ')}
            </AppText>
            {quality.level === 'low' ? <LowerQualityTag reasons={quality.reasons} /> : null}
          </HeadlineCard>
        </Reveal>

        {retake ? (
          <Reveal index={1}>
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: colors.flagBg,
                borderColor: colors.flag,
                borderWidth: 1,
                borderRadius: radius.card,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <AppText variant="headline">
                {retake === 'shortSlow' ? t('results.retakeShortSlow') : t('results.retakeShortFast')}
              </AppText>
              <Button
                label={t('results.retakeNow')}
                onPress={() => router.replace(`/measure/capture?mode=${reading.mode}`)}
              />
            </View>
          </Reveal>
        ) : null}

        {acuteFlag && !flagDeprioritized ? <Reveal index={1}>{findCareButton}</Reveal> : null}

        {diabetesCard ? (
          <Reveal index={2}>
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
              {lowReasons(diabetes) ? <LowerQualityTag small reasons={lowReasons(diabetes) ?? []} /> : null}
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
          </Reveal>
        ) : null}

        {orderedCards.map((card, position) =>
          card.key === 'extras' ? (
            <View key={card.key} style={{ gap: spacing.md }}>
              {card.node}
            </View>
          ) : (
            <Reveal key={card.key} index={3 + position}>
              {card.node}
            </Reveal>
          ),
        )}

        <Reveal index={8}>
          <ExperimentalCard
            experimental={scan.experimental}
            lowQualityReasons={lowReasons(scan.experimental)}
          />
        </Reveal>

        {flagDeprioritized ? <Reveal index={9}>{findCareButton}</Reveal> : null}

        <AppText tone="textDim">
          {t('result.notChecked')}{' '}
          <AppText accessibilityRole="link" tone="accent" onPress={() => router.push('/settings/accuracy')}>
            {t('results.accuracy')} ›
          </AppText>
        </AppText>
      </ScrollView>
      <SafetySheet visible={sheetOpen} onNo={() => setSheetOpen(false)} />
    </Screen>
  );
}

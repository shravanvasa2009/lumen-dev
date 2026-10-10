import { Stack, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { Confidence, ReadingResult } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { Reveal } from '@/components/Reveal';
import { Screen } from '@/components/Screen';
import { evidenceFor } from '@/evidence';
import { SectionLabel } from '@/settings/SectionLabel';
import { useStoredReadings } from '@/store/useStoredReadings';
import { useTheme } from '@/theme';

import { DemoBanner } from './DemoBanner';
import { showsPulseExtra } from './DiabetesCheckCard';
import { DiabetesRiskRow, PulseExtraRow } from './DiabetesRiskRow';
import { ExperimentalCard } from './ExperimentalCard';
import type { FixtureReading } from './fixtures';
import { DialTile } from './DialTile';
import { formatClock, formatDay } from './format';
import { HeartRateDial } from './HeartRateDial';
import { LowerQualityTag } from './LowerQualityTag';
import { MeasureRow } from './MeasureRow';
import { cleanSecondsNeeded } from '@/measure/mode';
import { isLowQuality, missingReasonText, metricReasons, readingQuality } from './quality';
import { ResultRing } from './ResultRing';
import { rhythmWords } from './rhythmWords';
import { SafetySheet } from './SafetySheet';
import { SignalQualityCard } from './SignalQualityCard';
import { clearSymptomsAsked, symptomsAskedFor } from './symptomsAsked';
import { TYPICAL_BREATHING, usualHeartRateBand } from './usualBand';
import { WhyPreviewCard } from './WhyPreviewCard';

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

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function confidenceWords(t: TFunction, confidence: Confidence): string {
  return { high: t('confidence.high'), moderate: t('confidence.moderate'), low: t('confidence.low') }[
    confidence
  ];
}

export function ReadingResults({ reading }: { reading: FixtureReading }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  // Side by side the labels wrap on a 360 dp phone or at large text, so the buttons stack there instead.
  const { width, fontScale } = useWindowDimensions();
  const stackActions = width < NARROW_WIDTH || fontScale > LARGE_TEXT_SCALE;
  const scan = reading.scan;
  const { hr, rhythm, rmssd, resp, diabetes } = scan.metrics;
  const quality = readingQuality(scan);
  const storedReadings = useStoredReadings();
  // A sample reading has no history of its own, so it never borrows the band of real readings on this phone.
  const heartBand = useMemo(
    () =>
      usualHeartRateBand(reading.sample ? [] : storedReadings, {
        id: reading.id,
        takenAt: reading.createdAt.getTime(),
      }),
    [reading.sample, reading.id, reading.createdAt, storedReadings],
  );
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
  // criterion the estimate is only the quiet Experimental row (ADR 0082); with it and no flag, nothing is shown.
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
  // A lower-quality reading says so under its headline; a flagged one already leads with that message.
  const subline =
    quality.level === 'low' && !flagDeprioritized
      ? t('results.lowQualityLead')
      : sublineText(t, reading, anyFlag);
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

  const ringFlagged = acuteFlag && !flagDeprioritized;
  // A lower-quality reading keeps the plain ring and a four-row list, as its board draws it; the hero dial and the
  // two dial tiles are for a reading that passed its floors.
  const tileMode = quality.level !== 'low' && !isLowQuality(rmssd) && !isLowQuality(resp);
  const dialMode = tileMode && hr !== null && !ringFlagged;
  const hasBeats = reading.intervalsMs.length > 0;
  const retakeNow = () => router.replace(`/measure/capture?mode=${reading.mode}`);
  // An irregular rhythm that asks for repeat readings offers the retake beside Find care, unless the short-reading
  // card above already carries its own Retake now.
  const offerRetake = scan.headlineKey === 'result.irregularRetake' && retake === null;
  const findCareButton = <Button label={t('results.findCare')} onPress={() => router.push('/care')} />;

  const rows: { key: string; low: boolean; node: (last: boolean) => ReactNode }[] = [
    {
      key: 'hr',
      low: isLowQuality(hr),
      node: (last) => (
        <MeasureRow
          icon="heart"
          title={t('results.heartRate')}
          subtitle={
            hr
              ? `${capitalized(t('results.noteResting'))} · ${confidenceWords(t, hr.confidence)}`
              : (knownMissing ?? t('result.inconclusive'))
          }
          value={hr ? { text: String(Math.round(hr.value)), unit: t('results.unitBpm') } : null}
          flagged={hrFlag}
          quietFlag={hrQuiet}
          lowQualityReasons={hr ? lowReasons(hr) : null}
          last={last}
        />
      ),
    },
    {
      key: 'rhythm',
      low: isLowQuality(rhythm),
      node: (last) => {
        const words = rhythm ? rhythmWords(t, rhythm) : null;
        return (
          <MeasureRow
            icon="rhythm"
            title={t('results.heartRhythm')}
            subtitle={
              rhythm && words
                ? `${capitalized(words.note)} · ${confidenceWords(t, rhythm.confidence)}${
                    rhythm.scorer === 'rule' ? ` · ${t('results.basicAnalysis')}` : ''
                  }`
                : (knownMissing ?? t('result.inconclusive'))
            }
            value={words ? { text: words.value } : null}
            flagged={rhythmFlag}
            quietFlag={rhythmQuiet}
            lowQualityReasons={rhythm ? lowReasons(rhythm) : null}
            footnote={rhythm?.flag !== null && lowReasons(rhythm) ? t('quality.confirmAf') : undefined}
            last={last}
          />
        );
      },
    },
    {
      key: 'hrv',
      low: isLowQuality(rmssd),
      node: (last) => (
        <MeasureRow
          icon="bars"
          title={t('results.hrv')}
          subtitle={
            rmssd
              ? `${capitalized(
                  rmssd.band
                    ? t('results.yourBand', {
                        low: Math.round(rmssd.band[0]),
                        high: Math.round(rmssd.band[1]),
                      })
                    : t('results.learningBand'),
                )} · ${confidenceWords(t, rmssd.confidence)}`
              : (hrvMissingText ?? knownMissing ?? t('result.inconclusive'))
          }
          value={rmssd ? { text: String(Math.round(rmssd.value)), unit: t('results.unitMs') } : null}
          lowQualityReasons={rmssd ? lowReasons(rmssd) : null}
          last={last}
        />
      ),
    },
    {
      key: 'resp',
      low: isLowQuality(resp),
      node: (last) => (
        <MeasureRow
          icon="breath"
          title={t('results.breathing')}
          subtitle={
            resp
              ? `${capitalized(t('results.noteResting'))} · ${confidenceWords(t, resp.confidence)}`
              : (knownMissing ?? t('result.inconclusive'))
          }
          value={resp ? { text: String(Math.round(resp.value)), unit: t('results.unitBrpm') } : null}
          lowQualityReasons={resp ? lowReasons(resp) : null}
          last={last}
        />
      ),
    },
  ];
  // Array.sort is stable, so the usual order holds inside each group. Only a quiet flag reorders the screen.
  const orderedRows = flagDeprioritized ? [...rows].sort((a, b) => Number(a.low) - Number(b.low)) : rows;
  // The dial tiles show HRV and breathing, so a reading that passed its floors lists only the other two.
  const shownRows = tileMode
    ? orderedRows.filter((row) => row.key === 'hr' || row.key === 'rhythm')
    : orderedRows;
  const hrvCaption = !rmssd
    ? (hrvMissingText ?? knownMissing ?? t('result.inconclusive'))
    : !rmssd.band
      ? t('results.tileLearning')
      : rmssd.value < rmssd.band[0]
        ? t('results.tileBelow')
        : rmssd.value > rmssd.band[1]
          ? t('results.tileAbove')
          : t('results.tileWithin');
  const hrvBand = rmssd?.band ? ([Math.round(rmssd.band[0]), Math.round(rmssd.band[1])] as const) : null;
  const dialTiles = (
    <>
      <DialTile
        icon="bars"
        title={t('results.tileHrv')}
        value={rmssd?.value ?? null}
        unit={t('results.unitMs')}
        scale={{ min: 10, max: 90, step: 4, majorEvery: 5 }}
        band={hrvBand}
        caption={hrvCaption}
        confidence={rmssd ? confidenceWords(t, rmssd.confidence) : undefined}
        legend={hrvBand ? t('results.legendMs', { low: hrvBand[0], high: hrvBand[1] }) : undefined}
        label={
          !rmssd
            ? `${t('results.tileHrv')}. ${hrvCaption}`
            : hrvBand
              ? t('results.hrvBandLabel', {
                  value: Math.round(rmssd.value),
                  low: hrvBand[0],
                  high: hrvBand[1],
                })
              : t('results.hrvLabel', { value: Math.round(rmssd.value) })
        }
      />
      <DialTile
        icon="breath"
        title={t('results.tileBreathing')}
        value={resp?.value ?? null}
        unit={t('results.tileUnitPerMin')}
        scale={{ min: 6, max: 30, step: 1, majorEvery: 6 }}
        band={resp ? [TYPICAL_BREATHING.low, TYPICAL_BREATHING.high] : null}
        caption={resp ? t('results.tileBreaths') : (knownMissing ?? t('result.inconclusive'))}
        confidence={resp ? confidenceWords(t, resp.confidence) : undefined}
        legend={
          resp
            ? t('results.legendTypical', { low: TYPICAL_BREATHING.low, high: TYPICAL_BREATHING.high })
            : undefined
        }
        label={
          resp
            ? t('results.breathLabel', {
                value: Math.round(resp.value),
                low: TYPICAL_BREATHING.low,
                high: TYPICAL_BREATHING.high,
              })
            : `${t('results.tileBreathing')}. ${knownMissing ?? t('result.inconclusive')}`
        }
      />
    </>
  );

  const heroCard = {
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg + 2,
  };
  const titleStack = { alignItems: 'center' as const, gap: spacing.xs };
  // The ring of a lower-quality reading fills as far as the clean seconds got toward the mode's target.
  const cleanShare = Math.min(1, scan.cleanSeconds / cleanSecondsNeeded(reading.mode));
  const titleLines = (
    <>
      {flagDeprioritized ? (
        <>
          <AppText variant="title" style={{ textAlign: 'center' }}>
            {t('results.lowQualityLead')}
          </AppText>
          <AppText variant="headline" style={{ textAlign: 'center' }}>
            {headlineText(t, reading)}
          </AppText>
        </>
      ) : (
        <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {headlineText(t, reading)}
        </AppText>
      )}
      {subline ? (
        <AppText tone="textDim" style={{ textAlign: 'center' }}>
          {subline}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
        {metaParts.join(' · ')}
      </AppText>
      {quality.level === 'low' ? (
        <View style={{ alignSelf: 'center' }}>
          <LowerQualityTag reasons={quality.reasons} />
        </View>
      ) : null}
    </>
  );

  return (
    <Screen>
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
      <ScrollView contentContainerStyle={{ gap: spacing.xxl, paddingBottom: spacing.lg }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <Reveal>
          <View testID="headline-card" style={{ alignItems: 'center', gap: spacing.xs }}>
            {dialMode && hr ? (
              <View style={{ ...heroCard, alignSelf: 'stretch' }}>
                <HeartRateDial bpm={Math.round(hr.value)} band={heartBand} />
                <View style={{ ...titleStack, paddingTop: spacing.md }}>{titleLines}</View>
              </View>
            ) : (
              <>
                {hr ? (
                  <ResultRing
                    value={String(Math.round(hr.value))}
                    unit={t('results.unitBpm')}
                    label={t('results.ringLabel', { value: Math.round(hr.value) })}
                    flagged={ringFlagged}
                    progress={tileMode ? 1 : cleanShare}
                  />
                ) : null}
                <View style={{ ...titleStack, paddingTop: spacing.md }}>{titleLines}</View>
              </>
            )}
          </View>
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
              <Button label={t('results.retakeNow')} onPress={retakeNow} />
            </View>
          </Reveal>
        ) : null}

        {ringFlagged ? (
          <Reveal index={1}>
            <View style={{ gap: spacing.sm }}>
              <SectionLabel>{t('results.nextSteps')}</SectionLabel>
              <View style={{ flexDirection: stackActions ? 'column' : 'row', gap: spacing.md }}>
                {offerRetake ? (
                  <View style={stackActions ? undefined : { flex: 1 }}>
                    <Button label={t('results.retakeNow')} onPress={retakeNow} />
                  </View>
                ) : null}
                <View style={stackActions ? undefined : { flex: 1 }}>
                  <Button
                    variant={offerRetake ? 'tint' : 'primary'}
                    label={t('results.findCare')}
                    onPress={() => router.push('/care')}
                  />
                </View>
              </View>
            </View>
          </Reveal>
        ) : null}

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
              <AppText variant="headline" style={{ color: colors.flag }}>
                {t('dm.flag.title')}
              </AppText>
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

        {quality.level === 'low' ? (
          <Reveal index={2}>
            <SignalQualityCard reading={reading} reasons={quality.reasons} />
          </Reveal>
        ) : null}

        <Reveal index={3}>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('results.measurements')}</SectionLabel>
            {tileMode ? (
              <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xs }}>
                {dialTiles}
              </View>
            ) : null}
            <Card flush>
              {shownRows.map((row, position) => (
                <View key={row.key}>{row.node(position === shownRows.length - 1)}</View>
              ))}
            </Card>
            <AppText variant="caption" tone="textDim">
              {t('result.notChecked')}
            </AppText>
          </View>
        </Reveal>

        {rhythm && hasBeats ? (
          <Reveal index={4}>
            <WhyPreviewCard readingId={reading.id} rhythm={rhythm} intervalsMs={reading.intervalsMs} />
          </Reveal>
        ) : null}

        <Reveal index={5}>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('results.understand')}</SectionLabel>
            <Card flush>
              <ListRow
                leading={<Icon name="hint" size={22} color={colors.accent} />}
                title={t('results.showWhy')}
                chevron
                onPress={() => router.push(`/results/${reading.id}/why`)}
              />
              <ListRow
                leading={<Icon name="share" size={22} color={colors.accent} />}
                title={t('results.doctorReport')}
                chevron
                onPress={() => router.push(`/report/${reading.id}`)}
              />
              <ListRow
                leading={<Icon name="bars" size={22} color={colors.accent} />}
                title={t('results.accuracy')}
                chevron
                last
                onPress={() => router.push('/settings/accuracy')}
              />
            </Card>
          </View>
        </Reveal>

        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('results.moreFromReading')}</SectionLabel>
          <DiabetesRiskRow readingId={reading.id} sample={reading.sample} />
        </View>

        <Reveal index={8}>
          <ExperimentalCard
            experimental={scan.experimental}
            lowQualityReasons={lowReasons(scan.experimental)}
            onOpenExtraBeats={hasBeats ? () => router.push(`/results/${reading.id}/extra-beats`) : undefined}
            pulseRow={showsPulseExtra(reading) ? <PulseExtraRow readingId={reading.id} /> : undefined}
          />
        </Reveal>

        <Card flush>
          <ListRow
            leading={<Icon name="standing" size={22} color={colors.accent} />}
            title={t('results.takeStanding')}
            chevron
            last
            onPress={() => router.push('/measure/standing-test')}
          />
        </Card>

        {flagDeprioritized ? <Reveal index={9}>{findCareButton}</Reveal> : null}

        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('prototype.banner')}
        </AppText>
      </ScrollView>
      <SafetySheet visible={sheetOpen} onNo={() => setSheetOpen(false)} />
    </Screen>
  );
}

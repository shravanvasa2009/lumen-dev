import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { formatNumber } from '@/i18n/formatNumber';
import { useTheme } from '@/theme';

import { intervalAxis } from './axis';
import { BeatStrip } from './BeatStrip';
import { DemoBanner } from './DemoBanner';
import { type FixtureReading, regularIntervalsMs } from './fixtures';
import { formatClock, formatDay } from './format';
import { LowerQualityTag } from './LowerQualityTag';
import { medianIntervalMs, rhythmMapShape } from './poincare';
import { metricReasons, readingQuality } from './quality';
import { RhythmGuide } from './RhythmGuide';
import { RhythmMap } from './RhythmMap';
import { RhythmMapSheet } from './RhythmMapSheet';
import { rhythmWords } from './rhythmWords';
import { Tachogram } from './Tachogram';
import { whyCopy } from './whyCopy';

export const BEAT_WINDOW_GAPS = 6;

// A tappable line at the foot of a card, set off by a hairline, as the boards draw "Beat by beat" and the map link.
function CardLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 44,
        marginTop: spacing.xs,
        borderTopColor: colors.line,
        borderTopWidth: StyleSheet.hairlineWidth,
      }}
    >
      <AppText tone="accent" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Icon name="chevron" size={16} color={colors.accent} />
    </Pressable>
  );
}

function Heading({ text, note }: { text: string; note?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="title3" accessibilityRole="header">
        {text}
      </AppText>
      {note ? (
        <AppText variant="subheadline" tone="textDim">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

export function WhyReading({ reading }: { reading: FixtureReading }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [mapHelpOpen, setMapHelpOpen] = useState(false);
  const { colors, radius, spacing } = useTheme();
  const { rhythm, hr, rmssd } = reading.scan.metrics;
  if (!rhythm || reading.intervalsMs.length === 0) {
    return (
      <Screen>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <AppText variant="title" accessibilityRole="header">
          {t('result.inconclusive')}
        </AppText>
      </Screen>
    );
  }

  const { title, explain } = whyCopy(t, rhythm);
  const axis = intervalAxis(reading.intervalsMs);
  const seriesColor = rhythm.flag ? colors.flag : colors.accent;
  // The accent text colour fails contrast on the dark plot panel; the fill teal passes (tokens.json).
  const plotColor = rhythm.flag ? colors.flag : colors.accentFill;
  const words = rhythmWords(t, rhythm);
  const lowReasons = metricReasons(rhythm, readingQuality(reading.scan));
  const confidence = {
    high: t('confidence.high'),
    moderate: t('confidence.moderate'),
    low: t('confidence.low'),
  }[rhythm.confidence];
  const median = medianIntervalMs(reading.intervalsMs);
  const shape = rhythmMapShape(reading.intervalsMs);
  const meta = [
    reading.mode === 'full' ? t('mode.full') : t('mode.quick'),
    t('results.cleanSeconds', { seconds: Math.floor(reading.scan.cleanSeconds) }),
    t('results.dayAt', {
      day: formatDay(reading.createdAt, i18n.language),
      time: formatClock(reading.createdAt, i18n.language),
    }),
  ].join(' · ');
  const summary = hr ? `${words.value} · ${t('results.bpm', { value: Math.round(hr.value) })}` : words.value;
  const numbers: { title: string; note: string; value?: string }[] = [
    ...(hr && median !== null
      ? [
          {
            title: t('results.heartRate'),
            note: t('why.numHr', { gap: Math.round(median), bpm: Math.round(60000 / median) }),
            value: t('results.bpm', { value: Math.round(hr.value) }),
          },
        ]
      : []),
    {
      title: t('why.numHrvTitle'),
      note: rmssd ? t('why.numHrvNote') : t('quality.missingNotSinus'),
      value: rmssd ? t('results.ms', { value: Math.round(rmssd.value) }) : undefined,
    },
    ...(shape
      ? [
          {
            title: t('why.numSdTitle'),
            note: t('why.numSdNote'),
            value: `${formatNumber(Math.round(shape.sd1Ms), i18n.language)} / ${t('results.ms', {
              value: formatNumber(Math.round(shape.sd2Ms), i18n.language),
            })}`,
          },
        ]
      : []),
    {
      title: t('why.numBeatsTitle'),
      note: t('why.numBeatsNote', { seconds: Math.floor(reading.scan.cleanSeconds) }),
      value: String(reading.scan.beats),
    },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.xxl, paddingBottom: spacing.lg }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <View style={{ gap: spacing.xs }}>
          <AppText variant="display" accessibilityRole="header">
            {title}
          </AppText>
          <AppText tone="textDim">{summary}</AppText>
          <AppText variant="caption" tone="textDim">
            {meta}
          </AppText>
        </View>
        {lowReasons ? <LowerQualityTag reasons={lowReasons} /> : null}

        {rhythm.flag ? (
          <View style={{ gap: spacing.sm }}>
            <Heading text={t('results.nextSteps')} />
            <Card flush>
              <ListRow
                leading={<Icon name="rhythm" size={22} color={colors.accent} />}
                title={t('quality.confirmAf')}
              />
              <ListRow
                leading={<Icon name="hint" size={22} color={colors.accent} />}
                title={t('why.askFor')}
                subtitle={t('why.askForBody')}
              />
              <ListRow
                leading={<Icon name="warning" size={22} color={colors.flag} />}
                title={t('emergency.body')}
                last
              />
            </Card>
            <Button variant="tint" label={t('emergency.title')} onPress={() => router.push('/emergency')} />
          </View>
        ) : null}

        <Card>
          <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
            {t('why.plainWords')}
          </AppText>
          <AppText variant="title3">{explain}</AppText>
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing.xs }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                backgroundColor: rhythm.flag ? colors.badgeFlagBg : colors.accentTint,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              }}
            >
              <Icon name="pulse" size={14} color={rhythm.flag ? colors.badgeFlagFg : colors.accent} />
              <AppText
                variant="caption"
                style={{ color: rhythm.flag ? colors.badgeFlagFg : colors.accent, fontWeight: '600' }}
              >
                {t('why.rhythmCheck')}
              </AppText>
            </View>
          </View>
          <AppText tone="textDim">{`${words.note} · ${confidence}`}</AppText>
          <AppText accessibilityRole="link" tone="accent" onPress={() => router.push('/settings/accuracy')}>
            {t('results.accuracy')} ›
          </AppText>
        </Card>

        <View style={{ gap: spacing.md }}>
          <Heading text={t('why.seeBeats')} />
          <Card>
            <BeatStrip intervalsMs={reading.intervalsMs.slice(0, BEAT_WINDOW_GAPS)} color={seriesColor} />
            <AppText variant="subheadline" tone="textDim">
              {t('why.beatsCaption')}
            </AppText>
            <CardLink
              label={t('why.beatByBeat')}
              onPress={() => router.push(`/results/${reading.id}/beats`)}
            />
          </Card>
        </View>

        <View style={{ gap: spacing.md }}>
          <Heading text={t('why.yourMap')} note={t('why.poincare')} />
          <Card>
            <RhythmMap
              intervalsMs={reading.intervalsMs}
              typicalIntervalsMs={regularIntervalsMs}
              axis={axis}
              color={plotColor}
              label={t('why.yourMapLabel', {
                dots: Math.max(0, reading.intervalsMs.length - 1),
                sd1: shape ? Math.round(shape.sd1Ms) : 0,
                sd2: shape ? Math.round(shape.sd2Ms) : 0,
              })}
            />
            <AppText variant="subheadline" tone="textDim">
              {t('why.mapCaption')}
            </AppText>
            <CardLink label={t('why.howMapMade')} onPress={() => setMapHelpOpen(true)} />
          </Card>
        </View>

        <View style={{ gap: spacing.md }}>
          <Heading text={t('why.readMapTitle')} />
          <Card>
            <RhythmGuide rhythmClass={rhythm.class} />
          </Card>
        </View>

        <View style={{ gap: spacing.md }}>
          <Heading text={t('why.intervals')} />
          <Card>
            <Tachogram intervalsMs={reading.intervalsMs} color={seriesColor} />
            <AppText variant="subheadline">{t('why.tachoCaption')}</AppText>
          </Card>
        </View>

        <Card flush>
          <ListRow
            title={t('why.extraBeats')}
            subtitle={t('why.extraBeatsNote', {
              rate: formatNumber(reading.scan.experimental.extraBeatsPerMin, i18n.language),
            })}
            chevron
            last
            onPress={() => router.push(`/results/${reading.id}/extra-beats`)}
          />
        </Card>

        <View style={{ gap: spacing.md }}>
          <Heading text={t('why.numbersTitle')} />
          <Card flush>
            {numbers.map((row, position) => (
              <ListRow
                key={row.title}
                title={row.title}
                subtitle={row.note}
                trailing={row.value ? <AppText variant="headline">{row.value}</AppText> : undefined}
                last={position === numbers.length - 1}
              />
            ))}
          </Card>
        </View>

        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('prototype.banner')}
        </AppText>
        <View style={{ gap: spacing.md }}>
          <Button label={t('why.retakeFull')} onPress={() => router.replace('/measure/capture?mode=full')} />
          <Button
            variant="tint"
            label={t('why.shareReport')}
            onPress={() => router.push(`/report/${reading.id}`)}
          />
        </View>
      </ScrollView>
      <RhythmMapSheet
        visible={mapHelpOpen}
        onClose={() => setMapHelpOpen(false)}
        intervalsMs={reading.intervalsMs}
        color={plotColor}
      />
    </Screen>
  );
}

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import {
  ActionButton,
  CardHeader,
  describedImage,
  Figure,
  FigureCard,
  GlyphTile,
  LinkTile,
} from './ChapterParts';
import { pulsePath } from './chapterWaves';
import { EmergencyCallCard, useEmergencyCall } from './EmergencyCallCard';
import { LessonGlyph } from './LessonGlyph';

type Step = {
  number: number;
  title: string;
  body: string;
  fill: string;
  ink: string;
  tint: string;
  action?: { label: string; glyph: 'call' | 'place'; tone: 'red' | 'teal'; onPress: () => void };
};

export function TriageLadder() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const { callEmergency, callFailed } = useEmergencyCall();
  const steps: readonly Step[] = [
    {
      number: 1,
      title: t('learn.doctor.step1Title'),
      body: t('learn.doctor.step1Body'),
      fill: colors.alertFill,
      ink: colors.onAlertFill,
      tint: colors.alertTint,
      action: {
        label: t('emergency.call'),
        glyph: 'call',
        tone: 'red',
        onPress: callEmergency,
      },
    },
    {
      number: 2,
      title: t('learn.doctor.step2Title'),
      body: t('learn.doctor.step2Body'),
      fill: colors.flag,
      ink: colors.bg,
      tint: colors.flagBg,
      action: {
        label: t('learn.doctor.findCare'),
        glyph: 'place',
        tone: 'teal',
        onPress: () => router.push('/care'),
      },
    },
    {
      number: 3,
      title: t('learn.doctor.step3Title'),
      body: t('learn.doctor.step3Body'),
      fill: colors.buttonFill,
      ink: colors.onButtonFill,
      tint: colors.accentTint,
    },
  ];
  return (
    <FigureCard>
      <CardHeader
        glyph="ladder"
        title={t('learn.doctor.ladderTitle')}
        subtitle={t('learn.doctor.ladderSub')}
      />
      <View accessibilityRole="list" accessibilityLabel={t('learn.doctor.ladderLabel')}>
        {steps.map((step, index) => (
          <View key={step.number} accessibilityRole="none" style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius.pill,
                  backgroundColor: step.fill,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="caption" style={{ color: step.ink, fontWeight: '700' }}>
                  {step.number}
                </AppText>
              </View>
              {index < steps.length - 1 ? (
                <View style={{ flex: 1, width: 3, backgroundColor: step.fill, opacity: 0.5 }} />
              ) : null}
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: step.tint,
                borderRadius: radius.card - 6,
                padding: spacing.md,
                gap: spacing.sm,
                marginBottom: index < steps.length - 1 ? spacing.md : 0,
              }}
            >
              <AppText variant="headline">{step.title}</AppText>
              <AppText variant="subheadline" tone="textDim">
                {step.body}
              </AppText>
              {step.action ? <ActionButton {...step.action} /> : null}
              {step.number === 1 && callFailed ? (
                <AppText accessibilityLiveRegion="polite" tone="alertText">
                  {t('learn.doctor.callFailed')}
                </AppText>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </FigureCard>
  );
}

export function ScreeningFlow() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const stages = [
    { glyph: 'screens', label: t('learn.doctor.screens'), last: false },
    { glyph: 'visit', label: t('learn.doctor.suggests'), last: false },
    { glyph: 'stethoscope', label: t('learn.doctor.diagnoses'), last: true },
  ] as const;
  return (
    <FigureCard>
      <View
        {...describedImage(t('learn.doctor.flowLabel'))}
        style={{ flexDirection: 'row', alignItems: 'flex-start' }}
      >
        {stages.map((stage, index) => (
          <View key={stage.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
              <GlyphTile
                name={stage.glyph}
                tint={stage.last ? colors.buttonFill : colors.accentTint}
                color={stage.last ? colors.onButtonFill : colors.accent}
              />
              <AppText variant="caption1" style={{ textAlign: 'center', fontWeight: '600' }}>
                {stage.label}
              </AppText>
            </View>
            {index < stages.length - 1 ? (
              <View style={{ height: 40, justifyContent: 'center' }}>
                <LessonGlyph name="arrowRight" size={16} color={colors.line2} weight={2} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          backgroundColor: colors.surface2,
          borderRadius: radius.pill,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        }}
      >
        <LessonGlyph name="cross" size={16} color={colors.textDim} weight={2.6} />
        <AppText variant="caption" tone="textDim" style={{ flexShrink: 1 }}>
          {t('learn.doctor.neverDiagnoses')}
        </AppText>
      </View>
    </FigureCard>
  );
}

export function DoctorEmergency() {
  const { t } = useTranslation();
  return (
    <EmergencyCallCard
      layout="grid"
      showNotReading={false}
      signs={[
        { glyph: 'heartAttack', label: t('learn.doctor.chipChest') },
        { glyph: 'faint', label: t('learn.doctor.chipFainting') },
        { glyph: 'breath', label: t('learn.doctor.chipBreath') },
        { glyph: 'stroke', label: t('learn.doctor.chipStroke') },
      ]}
    />
  );
}

const SIGNAL_WIDTH = 96;
const SIGNAL_HEIGHT = 56;
const irregularDays = [0, 3, 5] as const;
const dayXs = [9, 22, 35, 48, 61, 74, 87] as const;
const restingXs = [10, 26, 42, 58, 74, 90] as const;
const highYs = [10, 8, 11, 7, 9, 8] as const;
const lowYs = [46, 48, 45, 49, 47, 48] as const;

function WeekSignal() {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  // 5 October 2026 is a Monday, so the narrow weekday names start the row on Monday in either language.
  const letters = dayXs.map((_, day) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }).format(new Date(2026, 9, 5 + day)),
  );
  return (
    <Figure width={SIGNAL_WIDTH} height={SIGNAL_HEIGHT}>
      {dayXs.map((x, day) => (
        <SvgText
          key={x}
          x={x}
          y={15}
          fill={colors.textFaint}
          fontSize={9}
          fontWeight="600"
          textAnchor="middle"
        >
          {letters[day]}
        </SvgText>
      ))}
      {dayXs.map((x, day) => {
        const flagged = irregularDays.some((flaggedDay) => flaggedDay === day);
        return (
          <Rect
            key={x}
            x={x - 5}
            y={22}
            width={10}
            height={20}
            rx={3}
            fill={flagged ? colors.flag : colors.surface}
            stroke={flagged ? colors.flag : colors.line}
            strokeWidth={1}
          />
        );
      })}
      {irregularDays.map((day) => (
        <Circle key={day} cx={dayXs[day]} cy={32} r={2} fill={colors.surface} />
      ))}
    </Figure>
  );
}

function RestingSignal() {
  const { colors } = useTheme();
  return (
    <Figure width={SIGNAL_WIDTH} height={SIGNAL_HEIGHT}>
      <Rect x={0} y={21} width={SIGNAL_WIDTH} height={14} rx={4} fill={colors.accentTint} />
      <Path
        d="M0 21H96M0 35H96"
        stroke={colors.accent}
        strokeWidth={1}
        strokeDasharray="2 2"
        strokeOpacity={0.5}
      />
      {restingXs.map((x, index) => (
        <Circle key={`high${x}`} cx={x} cy={highYs[index]} r={3} fill={colors.flag} />
      ))}
      {restingXs.map((x, index) => (
        <Circle key={`low${x}`} cx={x} cy={lowYs[index]} r={3} fill={colors.flag} fillOpacity={0.45} />
      ))}
    </Figure>
  );
}

function RacingSignal() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Figure width={SIGNAL_WIDTH} height={SIGNAL_HEIGHT}>
      <Path
        d={pulsePath([8, 20, 32, 44, 86], { width: SIGNAL_WIDTH, baseY: 40, amplitude: 28, scale: 0.4 })}
        stroke={colors.pulse}
        strokeWidth={1.75}
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1={52} y1={40} x2={80} y2={40} stroke={colors.flag} strokeWidth={1} strokeDasharray="2 2" />
      <SvgText x={28} y={55} fill={colors.flag} fontSize={9} fontWeight="600" textAnchor="middle">
        {t('learn.doctor.races')}
      </SvgText>
      <SvgText x={66} y={55} fill={colors.flag} fontSize={9} fontWeight="600" textAnchor="middle">
        {t('learn.doctor.skips')}
      </SvgText>
    </Figure>
  );
}

function SignalRow({
  label,
  imageLabel,
  children,
}: {
  label: string;
  imageLabel: string;
  children: ReactNode;
}) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View accessibilityRole="none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View
        {...describedImage(imageLabel)}
        style={{
          width: 112,
          backgroundColor: colors.flagBg,
          borderRadius: radius.card - 8,
          padding: spacing.sm,
        }}
      >
        {children}
      </View>
      <AppText style={{ flex: 1, fontWeight: '600' }}>{label}</AppText>
    </View>
  );
}

export function BookAVisitSignals() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  return (
    <FigureCard>
      <View accessibilityRole="list" style={{ gap: spacing.md }}>
        <SignalRow label={t('learn.doctor.chipRepeat')} imageLabel={t('learn.doctor.weekLabel')}>
          <WeekSignal />
        </SignalRow>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <SignalRow label={t('learn.doctor.chipRate')} imageLabel={t('learn.doctor.rateLabel')}>
          <RestingSignal />
        </SignalRow>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <SignalRow label={t('learn.doctor.chipRacing')} imageLabel={t('learn.doctor.racesLabel')}>
          <RacingSignal />
        </SignalRow>
      </View>
      <ActionButton
        label={t('learn.doctor.findCare')}
        glyph="place"
        tone="teal"
        onPress={() => router.push('/care')}
      />
    </FigureCard>
  );
}

const reportColumnFlex = [1.2, 1, 0.8, 1.4, 1] as const;
const CLEAN_COLUMN = 4;
const reportRows = [0, 1, 2] as const;

// The rows are blank bars, not made-up readings: this is a picture of the report's layout.
export function ReportPreview() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const columns = [
    t('report.colTime'),
    t('report.colMode'),
    t('report.colHr'),
    t('report.colRhythm'),
    t('report.colClean'),
  ];
  return (
    <FigureCard>
      <View {...describedImage(t('learn.doctor.reportLabel'))} style={{ gap: spacing.sm }}>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.card - 8,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <LessonGlyph name="report" size={18} color={colors.accent} />
            <AppText variant="caption" style={{ fontWeight: '700' }}>
              {t('learn.doctor.reportTitle')}
            </AppText>
          </View>
          <AppText variant="caption1" tone="textDim">
            {t('learn.doctor.reportNote')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {columns.map((label, column) => (
              <AppText
                key={label}
                variant="caption1"
                numberOfLines={1}
                tone={column === CLEAN_COLUMN ? 'accent' : 'textDim'}
                style={{ flex: reportColumnFlex[column], fontWeight: '600' }}
              >
                {label}
              </AppText>
            ))}
          </View>
          {reportRows.map((row) => (
            <View key={row} style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
              {columns.map((label, column) => (
                <View key={label} style={{ flex: reportColumnFlex[column] }}>
                  <View
                    style={{
                      height: 8,
                      width: '70%',
                      borderRadius: 4,
                      backgroundColor: column === CLEAN_COLUMN ? colors.accentTint : colors.surface2,
                    }}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs }}
        >
          <AppText variant="caption" tone="accent">
            {t('learn.doctor.reliable')}
          </AppText>
          <LessonGlyph name="arrowUp" size={16} color={colors.accent} weight={2.25} />
        </View>
      </View>
    </FigureCard>
  );
}

export function HealthCenterLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <LinkTile
      leading={<GlyphTile name="clinic" tint={colors.accentTint} color={colors.accent} />}
      kicker={t('learn.doctor.finderKicker')}
      title={t('learn.doctor.finderTitle')}
      accessibilityLabel={`${t('learn.doctor.finderKicker')}: ${t('learn.doctor.finderTitle')}`}
      onPress={() => router.push('/care')}
    />
  );
}

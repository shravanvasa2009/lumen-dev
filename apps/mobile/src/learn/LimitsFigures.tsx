import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { CardHeader, describedImage, Figure, FigureCard, GlyphTile } from './ChapterParts';
import { ecgPath, pulsePath } from './chapterWaves';
import { EmergencyCallCard } from './EmergencyCallCard';
import { type GlyphName, LessonGlyph } from './LessonGlyph';

const HERO_WIDTH = 338;
const HERO_HEIGHT = 196;
const miniBeats = [10, 40, 70, 100, 130] as const;

export function LimitsHero({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { colors, gradients, radius, spacing, shadow } = useTheme();
  const tip = gradients.fingertip.stops;
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.sm,
        gap: spacing.md,
        ...shadow.raised,
      }}
    >
      <View
        {...describedImage(t('learn.limits.heroLabel'))}
        style={{ backgroundColor: colors.plotPanel, borderRadius: radius.card - 6, overflow: 'hidden' }}
      >
        <Figure width={HERO_WIDTH} height={HERO_HEIGHT}>
          <Defs>
            <RadialGradient id="limits-glow" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={tip[0]?.color} stopOpacity={0.9} />
              <Stop offset="0.45" stopColor={tip[2]?.color} stopOpacity={0.55} />
              <Stop offset="1" stopColor={tip[3]?.color} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="limits-tip" gradientUnits="userSpaceOnUse" cx="64" cy="70" r="46">
              <Stop offset="0" stopColor={tip[0]?.color} />
              <Stop offset="0.3" stopColor={tip[1]?.color} />
              <Stop offset="0.65" stopColor={tip[2]?.color} />
              <Stop offset="1" stopColor={tip[3]?.color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect
            x={16}
            y={20}
            width={132}
            height={200}
            rx={28}
            fill={colors.illustrationDevice}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={1.5}
          />
          <Rect x={28} y={32} width={72} height={112} rx={22} fill={colors.illustrationDeviceIsland} />
          <Circle
            cx={64}
            cy={66}
            r={15}
            fill={colors.illustrationLens}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={2}
          />
          <Circle
            cx={64}
            cy={116}
            r={13}
            fill={colors.illustrationLens}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={2}
          />
          <Circle cx={90} cy={44} r={6.5} fill={colors.illustrationFlash} />
          <Circle cx={64} cy={66} r={58} fill="url(#limits-glow)" />
          <G rotation={-38} origin="64, 66">
            <Rect x={40} y={-90} width={48} height={182} rx={24} fill={colors.illustrationSkin} />
            <Rect x={40} y={-90} width={48} height={182} rx={24} fill="url(#limits-tip)" opacity={0.92} />
          </G>
          <SvgText x={176} y={34} fill={colors.onPlot} fillOpacity={0.7} fontSize={12} fontWeight="600">
            {t('learn.limits.cameraGets')}
          </SvgText>
          <Rect x={170} y={46} width={156} height={66} rx={14} fill={colors.illustrationDevice} />
          <Path
            d={pulsePath(miniBeats, { width: 140, baseY: 100, amplitude: 38, scale: 0.9 })}
            transform="translate(178 -6)"
            stroke={colors.pulse}
            strokeWidth={2.5}
            strokeLinejoin="round"
            fill="none"
          />
          <SvgText x={176} y={140} fill={colors.onPlot} fontSize={15} fontWeight="600">
            {t('learn.limits.oneWaveA')}
          </SvgText>
          <SvgText x={176} y={160} fill={colors.onPlot} fontSize={15} fontWeight="600">
            {t('learn.limits.oneWaveB')}
          </SvgText>
        </Figure>
      </View>
      <View style={{ gap: spacing.sm, padding: spacing.sm }}>{children}</View>
    </View>
  );
}

type Ability = { glyph: GlyphName; label: string };

function AbilityColumn({
  title,
  mark,
  items,
  can,
}: {
  title: string;
  mark: GlyphName;
  items: readonly Ability[];
  can: boolean;
}) {
  const { colors, radius, spacing } = useTheme();
  const ink = can ? colors.accent : colors.textDim;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: can ? colors.accentTint : colors.surface2,
        borderRadius: radius.card - 6,
        padding: spacing.md,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <LessonGlyph name={mark} size={16} color={ink} weight={2.8} />
        <AppText variant="caption" style={{ color: ink, fontWeight: '700', flexShrink: 1 }}>
          {title}
        </AppText>
      </View>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <GlyphTile
            name={item.glyph}
            tint={colors.surface}
            color={can ? colors.accent : colors.textFaint}
            size={32}
          />
          <AppText variant="subheadline" style={{ flex: 1, fontWeight: can ? '600' : '400' }}>
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function CanAndCannot() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const can: readonly Ability[] = [
    { glyph: 'heart', label: t('learn.limits.canPulse') },
    { glyph: 'rhythm', label: t('learn.limits.canRhythm') },
    { glyph: 'bars', label: t('learn.limits.canHrv') },
    { glyph: 'breath', label: t('learn.limits.canBreathing') },
  ];
  const cannot: readonly Ability[] = [
    { glyph: 'noPressure', label: t('learn.limits.chipPressure') },
    { glyph: 'noOxygen', label: t('learn.limits.chipOxygen') },
    { glyph: 'noArteries', label: t('learn.limits.chipArteries') },
    { glyph: 'heartAttack', label: t('learn.limits.chipHeartAttack') },
    { glyph: 'ecg', label: t('learn.limits.cannotEcg') },
  ];
  return (
    <FigureCard>
      <CardHeader
        glyph="pulseCross"
        title={t('learn.limits.canCannotTitle')}
        subtitle={t('learn.limits.canCannotSub')}
      />
      <View
        {...describedImage(t('learn.limits.canCannotLabel'))}
        style={{ flexDirection: 'row', gap: spacing.sm }}
      >
        <AbilityColumn title={t('learn.limits.canTitle')} mark="check" items={can} can />
        <AbilityColumn title={t('learn.limits.cannotTitle')} mark="cross" items={cannot} can={false} />
      </View>
    </FigureCard>
  );
}

const TRACE_WIDTH = 338;
const TRACE_HEIGHT = 56;
const ecgGridStep = 14;
const lightBeats = [14, 76, 138, 200, 262] as const;

function TraceLabel({ dot, label }: { dot: string; label: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <AppText variant="caption" style={{ flex: 1, fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

export function LightWaveVersusEcg() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const gridLines = Array.from(
    { length: Math.floor(TRACE_WIDTH / ecgGridStep) + 1 },
    (_, index) => index * ecgGridStep,
  );
  return (
    <FigureCard>
      <CardHeader glyph="help" title={t('learn.limits.whyTitle')} subtitle={t('learn.limits.whySub')} />
      <View {...describedImage(t('learn.limits.whyLabel'))} style={{ gap: spacing.sm }}>
        <TraceLabel dot={colors.pulse} label={t('learn.limits.fingertipLight')} />
        <Figure width={TRACE_WIDTH} height={TRACE_HEIGHT}>
          <Path
            d={pulsePath(lightBeats, { width: TRACE_WIDTH, baseY: 50, amplitude: 36 })}
            stroke={colors.pulse}
            strokeWidth={2.25}
            strokeLinejoin="round"
            fill="none"
          />
        </Figure>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <TraceLabel dot={colors.text} label={t('learn.limits.ecgOffice')} />
        <View
          style={{ backgroundColor: colors.alertTint, borderRadius: radius.chip + 4, overflow: 'hidden' }}
        >
          <Figure width={TRACE_WIDTH} height={TRACE_HEIGHT}>
            {gridLines.map((x) => (
              <Line
                key={`v${x}`}
                x1={x}
                y1={0}
                x2={x}
                y2={TRACE_HEIGHT}
                stroke={colors.alertText}
                strokeOpacity={0.18}
                strokeWidth={0.75}
              />
            ))}
            {[0, 14, 28, 42, 56].map((y) => (
              <Line
                key={`h${y}`}
                x1={0}
                y1={y}
                x2={TRACE_WIDTH}
                y2={y}
                stroke={colors.alertText}
                strokeOpacity={0.18}
                strokeWidth={0.75}
              />
            ))}
            <Path
              d={ecgPath({ width: TRACE_WIDTH, baseY: 34, amplitude: 26, beatCount: 6 })}
              stroke={colors.text}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </Figure>
        </View>
      </View>
      <AppText variant="caption" tone="textDim">
        {t('learn.limits.ecgNote')}
      </AppText>
    </FigureCard>
  );
}

export function LimitsEmergency() {
  const { t } = useTranslation();
  return (
    <EmergencyCallCard
      layout="columns"
      showNotReading
      signs={[
        { glyph: 'heartAttack', label: t('learn.doctor.chipChest') },
        { glyph: 'faint', label: t('learn.doctor.chipFainting') },
        { glyph: 'breath', label: t('learn.doctor.chipBreath') },
      ]}
    />
  );
}

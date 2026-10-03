import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import type { LessonDiagramId } from './lessons';

const WAVE_WIDTH = 300;
const WAVE_HEIGHT = 120;
const WAVE_BEATS = 3;
const WAVE_BASE = 78;
const WAVE_AMPLITUDE = 44;
const GAP_WIDTH = 300;
const GAP_HEIGHT = 150;
const LABEL_SIZE = 12;

const beatSpacing = WAVE_WIDTH / WAVE_BEATS;
const beatCenters = Array.from({ length: WAVE_BEATS }, (_, index) => beatSpacing * (index + 0.5));
const firstBeatX = beatSpacing * 0.5;
const secondBeatX = beatSpacing * 1.5;

// One raised-cosine bump per beat, sampled every 4 units; a pulse wave is smooth, so a polyline reads as a curve.
const wavePath = Array.from({ length: WAVE_WIDTH / 4 + 1 }, (_, step) => {
  const x = step * 4;
  const phase = (x % beatSpacing) / beatSpacing;
  const lift = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  return `${step === 0 ? 'M' : 'L'}${x} ${WAVE_BASE - WAVE_AMPLITUDE * lift}`;
}).join(' ');

// Beat positions as fractions of the row width; the irregular row jumps around, the steady row does not.
const steadyBeats = [0.08, 0.24, 0.4, 0.56, 0.72, 0.88];
const irregularBeats = [0.06, 0.13, 0.4, 0.46, 0.7, 0.92];

// One screen-reader stop per diagram: the drawing is hidden, so its words travel in the label.
function imageProps(label: string) {
  return { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label };
}

function FingerOnLens() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const steps = [t('learn.pulse.step1'), t('learn.pulse.step2'), t('learn.pulse.step3')];
  return (
    <View
      {...imageProps(steps.join('. '))}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
    >
      <Svg
        width={96}
        height={132}
        viewBox="0 0 96 132"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Rect x={4} y={2} width={88} height={128} rx={18} fill={colors.illustrationDevice} />
        <Rect
          x={12}
          y={10}
          width={32}
          height={58}
          rx={16}
          fill={colors.illustrationDeviceIsland}
          stroke={colors.illustrationDeviceLine}
        />
        <Circle cx={28} cy={26} r={8} fill={colors.illustrationLens} stroke={colors.illustrationDeviceLine} />
        <Circle cx={28} cy={50} r={5} fill={colors.accent} />
        <Ellipse cx={30} cy={38} rx={20} ry={32} fill={colors.illustrationFinger} opacity={0.92} />
        <Line
          x1={52}
          y1={30}
          x2={80}
          y2={22}
          stroke={colors.accentFill}
          strokeWidth={2}
          strokeDasharray="3 3"
        />
        <Line
          x1={52}
          y1={46}
          x2={80}
          y2={54}
          stroke={colors.accentFill}
          strokeWidth={2}
          strokeDasharray="3 3"
        />
      </Svg>
      <View style={{ flex: 1, gap: spacing.sm }}>
        {steps.map((step, index) => (
          <AppText key={step} variant="caption">
            {`${index + 1}. ${step}`}
          </AppText>
        ))}
      </View>
    </View>
  );
}

function PulseWave() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const label = [
    t('learn.pulse.beatMark'),
    t('learn.pulse.gapMark'),
    t('learn.pulse.darker'),
    t('learn.pulse.lighter'),
  ].join('. ');
  return (
    <View
      {...imageProps(label)}
      style={{ backgroundColor: colors.plotPanel, borderRadius: radius.card, padding: spacing.md }}
    >
      <Svg
        width="100%"
        height={WAVE_HEIGHT}
        viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path d={wavePath} fill="none" stroke={colors.accentFill} strokeWidth={3} />
        {beatCenters.map((x) => (
          <Circle key={x} cx={x} cy={WAVE_BASE - WAVE_AMPLITUDE} r={4} fill={colors.accentFill} />
        ))}
        <SvgText x={firstBeatX} y={14} fill={colors.onPlot} fontSize={LABEL_SIZE} textAnchor="middle">
          {t('learn.pulse.beatMark')}
        </SvgText>
        <Line
          x1={firstBeatX}
          y1={WAVE_HEIGHT - 22}
          x2={secondBeatX}
          y2={WAVE_HEIGHT - 22}
          stroke={colors.onPlot}
          strokeWidth={1.5}
        />
        <SvgText
          x={(firstBeatX + secondBeatX) / 2}
          y={WAVE_HEIGHT - 6}
          fill={colors.onPlot}
          fontSize={LABEL_SIZE}
          textAnchor="middle"
        >
          {t('learn.pulse.gapMark')}
        </SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <AppText variant="caption" style={{ color: colors.onPlot }}>
          {t('learn.pulse.darker')}
        </AppText>
        <AppText variant="caption" style={{ color: colors.onPlot }}>
          {t('learn.pulse.lighter')}
        </AppText>
      </View>
    </View>
  );
}

type BeatRowProps = { fractions: readonly number[]; top: number; color: string; label: string };

function BeatRow({ fractions, top, color, label }: BeatRowProps) {
  const { colors } = useTheme();
  return (
    <>
      <SvgText x={4} y={top} fill={colors.onPlot} fontSize={LABEL_SIZE} fontWeight="600">
        {label}
      </SvgText>
      {fractions.map((fraction) => (
        <Line
          key={fraction}
          x1={fraction * GAP_WIDTH}
          y1={top + 8}
          x2={fraction * GAP_WIDTH}
          y2={top + 44}
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}
      <Line
        x1={0}
        y1={top + 50}
        x2={GAP_WIDTH}
        y2={top + 50}
        stroke={colors.onPlot}
        strokeWidth={1}
        opacity={0.4}
      />
    </>
  );
}

function RhythmGaps() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const label = `${t('learn.rhythm.steady')}. ${t('learn.rhythm.irregular')}`;
  return (
    <View
      {...imageProps(label)}
      style={{ backgroundColor: colors.plotPanel, borderRadius: radius.card, padding: spacing.md }}
    >
      <Svg
        width="100%"
        height={GAP_HEIGHT}
        viewBox={`0 0 ${GAP_WIDTH} ${GAP_HEIGHT}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BeatRow
          fractions={steadyBeats}
          top={14}
          color={colors.accentFill}
          label={t('learn.rhythm.steady')}
        />
        <BeatRow
          fractions={irregularBeats}
          top={84}
          color={colors.flag}
          label={t('learn.rhythm.irregular')}
        />
      </Svg>
    </View>
  );
}

export function LessonDiagram({ id }: { id: LessonDiagramId }) {
  if (id === 'finger-on-lens') return <FingerOnLens />;
  if (id === 'pulse-wave') return <PulseWave />;
  return <RhythmGaps />;
}

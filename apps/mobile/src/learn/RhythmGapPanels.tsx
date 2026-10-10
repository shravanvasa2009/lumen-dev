import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { type BeatShape, irregularGapsMs, peakPositions, pulsePath, steadyGapsMs } from './rhythmFigureMath';

const WIDTH = 338;
const TRACE_HEIGHT = 62;
const BARS_HEIGHT = 56;
const BARS_BASE = 52;
const FIRST_PEAK_X = 18.2;
const PX_PER_MS = 0.0555;
const PEAK_Y = 22;
// A bar's height grows with its gap above a 400 ms floor, so a steady rhythm draws level bars.
const BAR_FLOOR_MS = 400;
const BAR_PX_PER_MS = 0.0513;
const STEADY_REFERENCE_MS = 935;
const SHAPE: BeatShape = {
  baseline: 58,
  peak: 36,
  bump: 15,
  bumpOffset: 15,
  peakWidth: 3.4,
  bumpWidth: 5,
};

type GapPanelProps = {
  title: string;
  gapsMs: readonly number[];
  tone: 'steady' | 'irregular';
};

function GapPanel({ title, gapsMs, tone }: GapPanelProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const accent = tone === 'steady' ? colors.buttonFill : colors.flag;
  const barPanel = tone === 'steady' ? colors.accentTint : colors.flagBg;
  const peaks = peakPositions(gapsMs, FIRST_PEAK_X, PX_PER_MS);
  const barHeight = (gapMs: number) => (gapMs - BAR_FLOOR_MS) * BAR_PX_PER_MS;
  const referenceY = BARS_BASE - barHeight(STEADY_REFERENCE_MS);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
        <AppText variant="subheadline" style={{ flex: 1, fontWeight: '600' }}>
          {title}
        </AppText>
        <AppText variant="caption1" tone="textDim" style={{ fontWeight: '600' }}>
          {t('learn.rhythm.gapUnit')}
        </AppText>
      </View>
      <Svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${TRACE_HEIGHT}`}
        style={{ aspectRatio: WIDTH / TRACE_HEIGHT }}
      >
        <Path
          d={pulsePath(peaks, SHAPE, WIDTH, 1.1)}
          fill="none"
          stroke={colors.pulse}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {gapsMs.map((gapMs, index) => {
          const start = peaks[index]! + 2;
          const span = gapMs * PX_PER_MS - 4;
          return (
            <G key={`${index}-${gapMs}`}>
              <Path d={`M${start} 13.5v3h${span}v-3`} fill="none" stroke={colors.line} strokeWidth={1} />
              <SvgText
                x={start + span / 2}
                y={10}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight="600"
                fill={colors.textDim}
              >
                {gapMs}
              </SvgText>
            </G>
          );
        })}
        {peaks.map((peakX) => (
          <Circle
            key={peakX}
            cx={peakX}
            cy={PEAK_Y}
            r={3.5}
            fill={accent}
            stroke={colors.surface}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
      <View
        style={{ marginTop: 6, borderRadius: 14, backgroundColor: barPanel, paddingTop: 6, paddingBottom: 4 }}
      >
        <Svg
          width="100%"
          viewBox={`0 0 ${WIDTH} ${BARS_HEIGHT}`}
          style={{ aspectRatio: WIDTH / BARS_HEIGHT }}
        >
          <Path d={`M0 ${BARS_BASE}H${WIDTH}`} stroke={colors.line} strokeWidth={1} />
          <Path
            d={`M0 ${referenceY}H${WIDTH}`}
            stroke={colors.buttonFill}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
          {gapsMs.map((gapMs, index) => {
            const height = barHeight(gapMs);
            return (
              <Rect
                key={`${index}-${gapMs}`}
                x={peaks[index]! + 4}
                y={BARS_BASE - height}
                width={gapMs * PX_PER_MS - 8}
                height={height}
                rx={5}
                fill={accent}
                fillOpacity={0.85}
              />
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

export function RhythmGapPanels() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View>
      <GapPanel title={t('learn.rhythm.steady')} gapsMs={steadyGapsMs} tone="steady" />
      <View style={{ height: 0.5, backgroundColor: colors.line, marginVertical: spacing.lg }} />
      <GapPanel title={t('learn.rhythm.irregular')} gapsMs={irregularGapsMs} tone="irregular" />
      <AppText variant="caption" tone="textDim" style={{ marginTop: spacing.md }}>
        {t('learn.rhythm.barsCaption')}
      </AppText>
    </View>
  );
}

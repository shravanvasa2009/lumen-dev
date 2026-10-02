import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import type { ChartPoint } from './protocol';

const WIDTH = 340;
const HEIGHT = 170;
const PLOT = { left: 40, right: WIDTH - 8, top: 16, bottom: HEIGHT - 34 };
const TICK_COUNT = 4;
const LABEL_SIZE = 12;
// Visual width of the shaded lying band only; it is not a clinical range.
const BAND_HALF_HEIGHT_BPM = 3;

type HeartRateChartProps = {
  points: readonly ChartPoint[];
  baseline: number | null;
  label: string;
  lyingLabel: string;
  nowLabel: string;
};

function yAxis(points: readonly ChartPoint[]) {
  const bpms = points.map(({ bpm }) => bpm);
  const low = Math.floor((Math.min(...bpms) - 5) / 10) * 10;
  const high = Math.ceil((Math.max(...bpms) + 5) / 10) * 10;
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) =>
    Math.round(low + ((high - low) * i) / (TICK_COUNT - 1)),
  );
  return { low, high, ticks };
}

export function HeartRateChart({ points, baseline, label, lyingLabel, nowLabel }: HeartRateChartProps) {
  const { colors } = useTheme();
  const hasData = points.length > 0;
  const { low, high, ticks } = hasData ? yAxis(points) : { low: 0, high: 1, ticks: [] };
  const firstMinute = points[0]?.minute ?? 0;
  const lastMinute = Math.max(points.at(-1)?.minute ?? 0, firstMinute + 1);

  const xAt = (minute: number) =>
    PLOT.left + ((minute - firstMinute) / (lastMinute - firstMinute)) * (PLOT.right - PLOT.left);
  const yAt = (bpm: number) => PLOT.bottom - ((bpm - low) / (high - low)) * (PLOT.bottom - PLOT.top);
  const gridYs = hasData ? ticks.map(yAt) : [PLOT.top, PLOT.bottom];

  return (
    <Svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      style={{ aspectRatio: WIDTH / HEIGHT }}
      accessibilityLabel={label}
      accessible
    >
      {baseline === null ? null : (
        <Rect
          x={PLOT.left}
          y={yAt(baseline + BAND_HALF_HEIGHT_BPM)}
          width={PLOT.right - PLOT.left}
          height={yAt(baseline - BAND_HALF_HEIGHT_BPM) - yAt(baseline + BAND_HALF_HEIGHT_BPM)}
          fill={colors.accent}
          fillOpacity={0.14}
        />
      )}
      {gridYs.map((y) => (
        <Line key={y} x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} stroke={colors.line} strokeWidth={1} />
      ))}
      {ticks.map((tick) => (
        <SvgText
          key={tick}
          x={PLOT.left - 8}
          y={yAt(tick) + 4}
          fill={colors.textFaint}
          fontSize={LABEL_SIZE}
          textAnchor="end"
        >
          {tick}
        </SvgText>
      ))}
      {points.length > 1 ? (
        <Polyline
          points={points.map(({ minute, bpm }) => `${xAt(minute)},${yAt(bpm)}`).join(' ')}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ) : null}
      {points.map(({ minute, bpm }) => (
        <Circle key={minute} cx={xAt(minute)} cy={yAt(bpm)} r={4} fill={colors.accent} />
      ))}
      <SvgText x={PLOT.left} y={HEIGHT - 8} fill={colors.textFaint} fontSize={LABEL_SIZE}>
        {lyingLabel}
      </SvgText>
      <SvgText x={PLOT.right} y={HEIGHT - 8} fill={colors.textFaint} fontSize={LABEL_SIZE} textAnchor="end">
        {nowLabel}
      </SvgText>
    </Svg>
  );
}

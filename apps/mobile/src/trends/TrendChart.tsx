import { useTranslation } from 'react-i18next';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import type { Band } from './baseline';
import { cupPath } from './CupIcon';
import { chartAxis, type TrendPoint } from './series';

// The plot keeps a gutter on the right for the axis numbers, as the board does.
const width = 338;
const height = 224;
const left = 3;
const right = 38;
const top = 29;
const bottom = 53;
const axisLabelX = width;
const cupSize = 12;

type TrendChartProps = {
  points: readonly TrendPoint[];
  // Lower-quality readings: hollow, off the line, and outside the band.
  lowerPoints: readonly TrendPoint[];
  band: Band | null;
  label: string;
  firstLabel: string;
  middleLabel: string | null;
  lastLabel: string;
};

export function TrendChart({
  points,
  lowerPoints,
  band,
  label,
  firstLabel,
  middleLabel,
  lastLabel,
}: TrendChartProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const usualRangeLabel = t('trends.usualRange');
  const every = [...points, ...lowerPoints];
  const values = every.map((point) => point.value);
  const { low, high, step } = chartAxis(band ? [...values, band.low, band.high] : values);
  const gridValues = Array.from(
    { length: Math.round((high - low) / step) + 1 },
    (_, index) => low + index * step,
  );
  const yFor = (value: number) => top + ((high - value) / (high - low)) * (height - top - bottom);
  const times = every.map((point) => point.createdAt.getTime());
  const startMs = Math.min(...times);
  const spanMs = Math.max(...times) - startMs;
  // One reading, or several in the same instant, sit in the middle rather than against the axis.
  const xFor = (point: TrendPoint) =>
    spanMs === 0
      ? (left + width - right) / 2
      : left + ((point.createdAt.getTime() - startMs) / spanMs) * (width - right - left);
  const line = points.map((point) => `${xFor(point)},${yFor(point.value)}`).join(' ');
  return (
    <Svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ aspectRatio: width / height, overflow: 'visible' }}
      accessibilityLabel={label}
    >
      {band ? (
        <Rect
          x={left}
          y={yFor(band.high)}
          width={width - left - right}
          height={yFor(band.low) - yFor(band.high)}
          rx={6}
          fill={colors.accentTint}
        />
      ) : null}
      {band ? (
        <SvgText x={left + 8} y={yFor(band.high) + 17} fontSize={12} fill={colors.accent}>
          {usualRangeLabel}
        </SvgText>
      ) : null}
      {gridValues.map((value) => (
        <Line
          key={value}
          x1={left}
          x2={width - right}
          y1={yFor(value)}
          y2={yFor(value)}
          stroke={colors.line}
          strokeWidth={0.5}
          strokeDasharray="2 3"
        />
      ))}
      {gridValues.map((value) => (
        <SvgText
          key={value}
          x={axisLabelX}
          y={yFor(value) + 4}
          fontSize={11}
          fontWeight="500"
          fill={colors.textDim}
          textAnchor="end"
        >
          {value}
        </SvgText>
      ))}
      <Polyline
        points={line}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point) => (
        <Circle
          key={point.id}
          cx={xFor(point)}
          cy={yFor(point.value)}
          r={3}
          fill={colors.accent}
          stroke={colors.surface}
          strokeWidth={1.5}
        />
      ))}
      {lowerPoints.map((point) => (
        <Circle
          key={point.id}
          cx={xFor(point)}
          cy={yFor(point.value)}
          r={3.5}
          fill={colors.surface}
          stroke={colors.textDim}
          strokeWidth={1.5}
        />
      ))}
      {points
        .filter((point) => point.caffeine)
        .map((point) => (
          <G
            key={point.id}
            testID="context-marker"
            accessibilityLabel={t('precheck.caffeine')}
            transform={`translate(${xFor(point) - cupSize / 2},${yFor(point.value) - cupSize - 6}) scale(${cupSize / 24})`}
          >
            <Path d={cupPath} stroke={colors.flag} strokeWidth={2.4} strokeLinecap="round" fill="none" />
          </G>
        ))}
      <SvgText x={left} y={height - 8} fontSize={12} fill={colors.textDim}>
        {firstLabel}
      </SvgText>
      {middleLabel ? (
        <SvgText
          x={(left + width - right) / 2}
          y={height - 8}
          fontSize={12}
          fill={colors.textDim}
          textAnchor="middle"
        >
          {middleLabel}
        </SvgText>
      ) : null}
      <SvgText x={width - right} y={height - 8} fontSize={12} fill={colors.textDim} textAnchor="end">
        {lastLabel}
      </SvgText>
    </Svg>
  );
}

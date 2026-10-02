import { useTranslation } from 'react-i18next';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import type { Band } from './baseline';
import { cupPath } from './CupIcon';
import { chartAxis, type TrendPoint } from './series';

const width = 320;
const height = 200;
const left = 34;
const right = 8;
const top = 22;
const bottom = 28;
const cupSize = 12;

type TrendChartProps = {
  points: readonly TrendPoint[];
  band: Band | null;
  label: string;
  firstLabel: string;
  lastLabel: string;
};

export function TrendChart({ points, band, label, firstLabel, lastLabel }: TrendChartProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const values = points.map((point) => point.value);
  const { low, high, step } = chartAxis(band ? [...values, band.low, band.high] : values);
  const gridValues = Array.from(
    { length: Math.round((high - low) / step) + 1 },
    (_, index) => low + index * step,
  );
  const yFor = (value: number) => top + ((high - value) / (high - low)) * (height - top - bottom);
  const startMs = points[0]?.createdAt.getTime() ?? 0;
  const spanMs = (points[points.length - 1]?.createdAt.getTime() ?? 0) - startMs;
  // One reading, or several in the same instant, sit in the middle rather than against the axis.
  const xFor = (point: TrendPoint) =>
    spanMs === 0
      ? (left + width - right) / 2
      : left + ((point.createdAt.getTime() - startMs) / spanMs) * (width - left - right);
  const line = points.map((point) => `${xFor(point)},${yFor(point.value)}`).join(' ');
  return (
    <Svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ aspectRatio: width / height }}
      accessibilityLabel={label}
    >
      {band ? (
        <Rect
          x={left}
          y={yFor(band.high)}
          width={width - left - right}
          height={yFor(band.low) - yFor(band.high)}
          fill={colors.badgeCheckedBg}
        />
      ) : null}
      {gridValues.map((value) => (
        <Line
          key={value}
          x1={left}
          x2={width - right}
          y1={yFor(value)}
          y2={yFor(value)}
          stroke={colors.line}
          strokeWidth={1}
        />
      ))}
      {gridValues.map((value) => (
        <SvgText
          key={value}
          x={left - 6}
          y={yFor(value) + 4}
          fontSize={11}
          fill={colors.textFaint}
          textAnchor="end"
        >
          {value}
        </SvgText>
      ))}
      <Polyline points={line} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinejoin="round" />
      {points.map((point) => (
        <Circle key={point.id} cx={xFor(point)} cy={yFor(point.value)} r={3} fill={colors.accent} />
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
      <SvgText x={left} y={height - 8} fontSize={11} fill={colors.textFaint}>
        {firstLabel}
      </SvgText>
      <SvgText x={width - right} y={height - 8} fontSize={11} fill={colors.textFaint} textAnchor="end">
        {lastLabel}
      </SvgText>
    </Svg>
  );
}

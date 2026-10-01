import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

const width = 320;
const height = 150;
const left = 38;
const right = 10;
const top = 10;
const bottom = 26;
// Fixed axis so a regular and an irregular reading are drawn on the same scale (mockup 18).
const lowMs = 400;
const highMs = 1200;
const gridMs = [lowMs, 800, highMs];

type TachogramProps = { intervalsMs: readonly number[]; color: ColorValue };

export function Tachogram({ intervalsMs, color }: TachogramProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const yFor = (ms: number) => {
    const clamped = Math.min(highMs, Math.max(lowMs, ms));
    return top + ((highMs - clamped) / (highMs - lowMs)) * (height - top - bottom);
  };
  const xFor = (index: number) =>
    left + (index / Math.max(1, intervalsMs.length - 1)) * (width - left - right);
  const points = intervalsMs.map((ms, index) => `${xFor(index)},${yFor(ms)}`).join(' ');
  return (
    <Svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ aspectRatio: width / height }}
      accessibilityLabel={t('why.intervalsChart', { beats: intervalsMs.length })}
    >
      {gridMs.map((ms) => (
        <Line
          key={ms}
          x1={left}
          x2={width - right}
          y1={yFor(ms)}
          y2={yFor(ms)}
          stroke={colors.line}
          strokeWidth={1}
        />
      ))}
      {gridMs.map((ms) => (
        <SvgText
          key={ms}
          x={left - 6}
          y={yFor(ms) + 4}
          fontSize={11}
          fill={colors.textFaint}
          textAnchor="end"
        >
          {ms}
        </SvgText>
      ))}
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {intervalsMs.map((ms, index) => (
        <Circle key={index} cx={xFor(index)} cy={yFor(ms)} r={2.5} fill={color} />
      ))}
      <SvgText x={width - right} y={height - 6} fontSize={11} fill={colors.textFaint} textAnchor="end">
        {`${t('why.beat')} →`}
      </SvgText>
    </Svg>
  );
}

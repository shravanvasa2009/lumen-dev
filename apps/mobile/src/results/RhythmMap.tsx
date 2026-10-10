import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Ellipse, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import { rhythmMapShape, type RhythmMapShape } from './poincare';

const WIDTH = 338;
const HEIGHT = 340;
const LEFT = 54;
const RIGHT = WIDTH - 16;
const TOP = 14;
const BOTTOM = 284;
const GRID_STEP_MS = 100;
// The outline is two standard deviations, which holds about 86% of a cloud's dots.
const OUTLINE_SDS = 2;

type RhythmMapProps = {
  intervalsMs: readonly number[];
  // The typical regular reading drawn as a dashed outline to compare against; same axis as the dots.
  typicalIntervalsMs: readonly number[];
  axis: { lowMs: number; highMs: number };
  color: ColorValue;
  label: string;
};

function outlineFor(shape: RhythmMapShape, toX: (ms: number) => number, toY: (ms: number) => number) {
  const scalePerMs = (toX(shape.centerMs + 1) - toX(shape.centerMs)) * OUTLINE_SDS;
  return {
    cx: toX(shape.centerMs),
    cy: toY(shape.centerMs),
    rx: Math.max(2, shape.sd2Ms * scalePerMs),
    ry: Math.max(2, shape.sd1Ms * scalePerMs),
  };
}

// The full rhythm map (a Poincare plot): one dot per pair of neighbouring gaps, this gap across and the next
// one up. A steady heart makes a narrow streak along the dashed diagonal; an irregular one spreads out.
export function RhythmMap({ intervalsMs, typicalIntervalsMs, axis, color, label }: RhythmMapProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const span = axis.highMs - axis.lowMs;
  const toX = (ms: number) => LEFT + ((ms - axis.lowMs) / span) * (RIGHT - LEFT);
  const toY = (ms: number) => BOTTOM - ((ms - axis.lowMs) / span) * (BOTTOM - TOP);
  const ticks: number[] = [];
  for (let ms = Math.ceil(axis.lowMs / GRID_STEP_MS) * GRID_STEP_MS; ms <= axis.highMs; ms += GRID_STEP_MS)
    ticks.push(ms);
  // Labels every 200 ms when the axis is wide, so they never crowd on a small phone.
  const labelled = ticks.filter((ms) => span <= 500 || ms % 200 === 0);
  const shape = rhythmMapShape(intervalsMs);
  const typical = rhythmMapShape(typicalIntervalsMs);
  const yours = shape ? outlineFor(shape, toX, toY) : null;
  const usual = typical ? outlineFor(typical, toX, toY) : null;
  return (
    <Svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      style={{ aspectRatio: WIDTH / HEIGHT }}
      accessibilityLabel={label}
    >
      <Rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={16} fill={colors.plotPanel} />
      {ticks.map((ms) => (
        <Line
          key={`v${ms}`}
          x1={toX(ms)}
          x2={toX(ms)}
          y1={TOP}
          y2={BOTTOM}
          stroke={colors.onPlot}
          strokeOpacity={0.18}
        />
      ))}
      {ticks.map((ms) => (
        <Line
          key={`h${ms}`}
          x1={LEFT}
          x2={RIGHT}
          y1={toY(ms)}
          y2={toY(ms)}
          stroke={colors.onPlot}
          strokeOpacity={0.18}
        />
      ))}
      {labelled.map((ms) => (
        <SvgText
          key={`lx${ms}`}
          x={toX(ms)}
          y={BOTTOM + 18}
          fontSize={11}
          fill={colors.onPlot}
          textAnchor="middle"
        >
          {ms}
        </SvgText>
      ))}
      {labelled.map((ms) => (
        <SvgText
          key={`ly${ms}`}
          x={LEFT - 8}
          y={toY(ms) + 4}
          fontSize={11}
          fill={colors.onPlot}
          textAnchor="end"
        >
          {ms}
        </SvgText>
      ))}
      <Rect
        x={LEFT}
        y={TOP}
        width={RIGHT - LEFT}
        height={BOTTOM - TOP}
        fill="none"
        stroke={colors.onPlot}
        strokeOpacity={0.4}
      />
      <Line
        x1={LEFT}
        y1={BOTTOM}
        x2={RIGHT}
        y2={TOP}
        stroke={colors.onPlot}
        strokeOpacity={0.6}
        strokeWidth={1.25}
        strokeDasharray="4 4"
      />
      {usual ? (
        <Ellipse
          {...usual}
          transform={`rotate(-45 ${usual.cx} ${usual.cy})`}
          fill="none"
          stroke={colors.onPlot}
          strokeOpacity={0.7}
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
      ) : null}
      {yours ? (
        <Ellipse
          {...yours}
          transform={`rotate(-45 ${yours.cx} ${yours.cy})`}
          fill={color}
          fillOpacity={0.12}
          stroke={color}
          strokeWidth={1.25}
        />
      ) : null}
      {intervalsMs.slice(0, -1).map((ms, index) => (
        <Circle
          key={index}
          cx={toX(ms)}
          cy={toY(intervalsMs[index + 1] ?? ms)}
          r={3}
          fill={color}
          fillOpacity={0.7}
        />
      ))}
      <SvgText x={(LEFT + RIGHT) / 2} y={HEIGHT - 12} fontSize={12} fill={colors.onPlot} textAnchor="middle">
        {t('why.thisGap')}
      </SvgText>
      <SvgText
        x={0}
        y={0}
        fontSize={12}
        fill={colors.onPlot}
        textAnchor="middle"
        transform={`translate(14 ${(TOP + BOTTOM) / 2}) rotate(-90)`}
      >
        {t('why.nextGap')}
      </SvgText>
    </Svg>
  );
}

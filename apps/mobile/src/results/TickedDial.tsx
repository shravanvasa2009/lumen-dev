import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

// A 270 degree gauge that opens at the bottom: 40 bpm sits at 7:30 on the clock face and 120 bpm at 4:30.
const START_DEGREES = 135;
const SWEEP_DEGREES = 270;

type Shape = {
  size: number;
  arcRadius: number;
  trackWidth: number;
  progressWidth: number;
  dotRadius: number;
  dotRing: number;
  tickEnd: number;
  minorStart: number;
  majorStart: number;
  minorWidth: number;
  majorWidth: number;
};

const SHAPES = {
  hero: {
    size: 220,
    arcRadius: 80,
    trackWidth: 10,
    progressWidth: 3,
    dotRadius: 8,
    dotRing: 2.5,
    tickEnd: 100,
    minorStart: 93,
    majorStart: 89,
    minorWidth: 1.5,
    majorWidth: 2,
  },
  mini: {
    size: 88,
    arcRadius: 32,
    trackWidth: 6,
    progressWidth: 2,
    dotRadius: 5,
    dotRing: 2,
    tickEnd: 43.5,
    minorStart: 39.5,
    majorStart: 37.5,
    minorWidth: 1.25,
    majorWidth: 1.75,
  },
} satisfies Record<string, Shape>;

export type DialSize = keyof typeof SHAPES;

type TickedDialProps = {
  size: DialSize;
  // The scale: ticks run from min to max, one every `step`, and every `majorEvery` ticks is a longer one.
  min: number;
  max: number;
  step: number;
  majorEvery: number;
  // Null draws the empty dial of a check that gave no value.
  value: number | null;
  // The person's usual (or typical) range, shaded on the ring and in teal ticks.
  band: readonly [number, number] | null;
  label: string;
  // Hero dials print the scale ends under the opening.
  showEnds?: boolean;
  children?: ReactNode;
};

const clampToScale = (position: number) => Math.min(1, Math.max(0, position));

// Ticks and arcs for one gauge. The value dot and the band are drawn on the ring itself, so the dial reads
// the same in a hero card and in a small tile.
export function TickedDial({
  size,
  min,
  max,
  step,
  majorEvery,
  value,
  band,
  label,
  showEnds = false,
  children,
}: TickedDialProps) {
  const { colors, isDark } = useTheme();
  const shape = SHAPES[size];
  const center = shape.size / 2;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const degreesAt = (scaleValue: number) =>
    START_DEGREES + SWEEP_DEGREES * clampToScale((scaleValue - min) / (max - min));
  const pointAt = (degrees: number, radius: number) => ({
    x: center + radius * Math.cos(toRadians(degrees)),
    y: center + radius * Math.sin(toRadians(degrees)),
  });
  const arc = (fromDegrees: number, toDegrees: number) => {
    const from = pointAt(fromDegrees, shape.arcRadius);
    const to = pointAt(toDegrees, shape.arcRadius);
    const large = toDegrees - fromDegrees > 180 ? 1 : 0;
    return `M${from.x.toFixed(2)} ${from.y.toFixed(2)}A${shape.arcRadius} ${shape.arcRadius} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  };

  const tickCount = Math.round((max - min) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const tickValue = min + index * step;
    const degrees = degreesAt(tickValue);
    const major = index % majorEvery === 0;
    const inBand = band !== null && tickValue >= band[0] && tickValue <= band[1];
    const from = pointAt(degrees, major ? shape.majorStart : shape.minorStart);
    const to = pointAt(degrees, shape.tickEnd);
    return { index, major, inBand, from, to };
  });

  const bandColor = colors.accent;
  const minorColor = isDark ? colors.line2 : colors.line;
  const majorColor = colors.glyph;
  const stroke = (major: boolean, inBand: boolean) => (inBand ? bandColor : major ? majorColor : minorColor);
  const valueDegrees = value === null ? null : degreesAt(value);
  const dot = valueDegrees === null ? null : pointAt(valueDegrees, shape.arcRadius);
  const endLabelY = center + 47.8;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: shape.size, height: shape.size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={shape.size} height={shape.size} style={{ position: 'absolute' }}>
        {[false, true].map((major) => (
          <G key={String(major)} strokeLinecap="round">
            {ticks
              .filter((tick) => tick.major === major)
              .map((tick) => (
                <Line
                  key={tick.index}
                  x1={tick.from.x}
                  y1={tick.from.y}
                  x2={tick.to.x}
                  y2={tick.to.y}
                  stroke={stroke(major, tick.inBand)}
                  strokeWidth={major ? shape.majorWidth : shape.minorWidth}
                />
              ))}
          </G>
        ))}
        <Path
          d={arc(START_DEGREES, START_DEGREES + SWEEP_DEGREES)}
          fill="none"
          stroke={colors.surface2}
          strokeWidth={shape.trackWidth}
          strokeLinecap="round"
        />
        {band ? (
          <Path
            d={arc(degreesAt(band[0]), degreesAt(band[1]))}
            fill="none"
            stroke={bandColor}
            strokeOpacity={isDark ? 0.38 : 0.3}
            strokeWidth={shape.trackWidth}
            strokeLinecap="round"
          />
        ) : null}
        {valueDegrees !== null && dot !== null ? (
          <>
            {valueDegrees > START_DEGREES ? (
              <Path
                d={arc(START_DEGREES, valueDegrees)}
                fill="none"
                stroke={bandColor}
                strokeOpacity={0.9}
                strokeWidth={shape.progressWidth}
                strokeLinecap="round"
              />
            ) : null}
            <Circle
              cx={dot.x}
              cy={dot.y}
              r={shape.dotRadius}
              fill={bandColor}
              stroke={colors.surface}
              strokeWidth={shape.dotRing}
            />
          </>
        ) : null}
        {showEnds ? (
          <>
            <SvgText
              x={center - 43.8}
              y={endLabelY}
              textAnchor="middle"
              fontSize={11}
              fontWeight="600"
              fill={colors.textDim}
            >
              {String(min)}
            </SvgText>
            <SvgText
              x={center + 43.8}
              y={endLabelY}
              textAnchor="middle"
              fontSize={11}
              fontWeight="600"
              fill={colors.textDim}
            >
              {String(max)}
            </SvgText>
          </>
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

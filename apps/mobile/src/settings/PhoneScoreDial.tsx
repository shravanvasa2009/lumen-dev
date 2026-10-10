import { View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

const SIZE = 230;
const CENTER = SIZE / 2;
const STROKE = 14;
const RING_RADIUS = 93;
const TICK_INNER = 103;
const TICK_OUTER = 106;
const LABEL_RADIUS = 113;
// The dial opens at the bottom: it starts at 135 degrees clockwise from the right and sweeps 270 degrees.
const START_DEGREES = 135;
const SWEEP_DEGREES = 270;
const MAX_SCORE = 100;
const SEGMENT_GAP_DEGREES = 3;
// A fine hatch on the arcs, as the board draws them.
const HATCH = '2.2 1.97';
const SCALE_LABELS = [0, 50, 100] as const;

export type DialSegment = { points: number | null; max: number; color: string };

function pointAt(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function arc(fromDegrees: number, toDegrees: number) {
  const from = pointAt(RING_RADIUS, fromDegrees);
  const to = pointAt(RING_RADIUS, toDegrees);
  const largeArc = toDegrees - fromDegrees > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArc} 1 ${to.x} ${to.y}`;
}

const degreesForScore = (score: number) => START_DEGREES + (score * SWEEP_DEGREES) / MAX_SCORE;

type PhoneScoreDialProps = {
  // The four rating components, in the order they are drawn around the dial; each owns a share of the ring
  // equal to its weight in the score.
  segments: readonly DialSegment[];
  label: string;
  tier: string;
  testedLine: string;
  summary: string;
};

export function PhoneScoreDial({ segments, label, tier, testedLine, summary }: PhoneScoreDialProps) {
  const { colors } = useTheme();
  let cursor = START_DEGREES;
  const arcs = segments.map(({ points, max, color }, index) => {
    const sweep = (max / MAX_SCORE) * SWEEP_DEGREES;
    const from = cursor;
    const to = cursor + sweep - (index === segments.length - 1 ? 0 : SEGMENT_GAP_DEGREES);
    cursor += sweep;
    const filled = points === null ? 0 : Math.min(Math.max(points / max, 0), 1);
    return { from, to, color, filledTo: from + (to - from) * filled };
  });
  // One tick per 5 points; 0, 50 and 100 carry the number instead.
  const ticks = Array.from({ length: MAX_SCORE / 5 - 1 }, (_, index) => (index + 1) * 5)
    .filter((score) => score !== 50)
    .map((score) => ({
      score,
      inner: pointAt(TICK_INNER, degreesForScore(score)),
      outer: pointAt(TICK_OUTER, degreesForScore(score)),
    }));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      style={{ width: SIZE, height: SIZE, alignSelf: 'center' }}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {arcs.map(({ from, to }) => (
          <Path
            key={`track-${from}`}
            d={arc(from, to)}
            stroke={colors.surface3}
            strokeWidth={STROKE}
            strokeDasharray={HATCH}
            fill="none"
          />
        ))}
        {arcs.map(({ from, filledTo, color }) =>
          filledTo > from ? (
            <Path
              key={`fill-${from}`}
              d={arc(from, filledTo)}
              stroke={color}
              strokeWidth={STROKE}
              strokeDasharray={HATCH}
              fill="none"
            />
          ) : null,
        )}
        {ticks.map(({ score, inner, outer }) => (
          <Line
            key={score}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke={colors.line}
            strokeWidth={1.25}
            strokeLinecap="round"
          />
        ))}
        {SCALE_LABELS.map((score) => {
          const at = pointAt(LABEL_RADIUS, degreesForScore(score));
          return (
            <SvgText
              key={score}
              x={at.x}
              y={at.y + 3.5}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight="600"
              fill={colors.textFaint}
            >
              {score}
            </SvgText>
          );
        })}
      </Svg>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 64,
          alignItems: 'center',
          gap: 0,
        }}
      >
        <AppText variant="vitalXL" style={{ fontSize: 68, lineHeight: 72, letterSpacing: -1.4 }}>
          {label}
        </AppText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            height: 26,
            paddingHorizontal: 12,
            borderRadius: 13,
            backgroundColor: colors.accentTint,
          }}
        >
          <Icon name="check" size={13} color={colors.accent} />
          <AppText variant="subheadline" tone="accent" style={{ fontWeight: '700' }}>
            {tier}
          </AppText>
        </View>
      </View>
      <AppText
        variant="caption"
        tone="textDim"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center' }}
      >
        {testedLine}
      </AppText>
    </View>
  );
}

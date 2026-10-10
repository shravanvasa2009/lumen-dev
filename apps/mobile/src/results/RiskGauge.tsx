import { View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const WIDTH = 338;
const HEIGHT = 170;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 150;
const RADIUS = 118;
const STROKE = 18;
const SEGMENTS = 10;
// Each segment is 18 degrees of the half circle, with a 2.4 degree gap so they read as separate steps.
const SEGMENT_DEGREES = 180 / SEGMENTS;
const GAP_DEGREES = 2.4;
// Bang 2009 and @lumen/core's adaRisk: 5 points or more is the higher-risk cut-off.
const HIGHER_FROM = 5;

type RiskGaugeProps = {
  points: number;
  pointsWord: string;
  higherLabel: string;
  lowerEnd: string;
  higherEnd: string;
  label: string;
};

const pointOn = (degrees: number, radius: number) => ({
  x: CENTER_X + radius * Math.cos((degrees * Math.PI) / 180),
  y: CENTER_Y + radius * Math.sin((degrees * Math.PI) / 180),
});

// The risk score on a half-circle of ten steps: one filled step per point, a marker where "higher risk" begins.
export function RiskGauge({ points, pointsWord, higherLabel, lowerEnd, higherEnd, label }: RiskGaugeProps) {
  const { colors } = useTheme();
  const flagged = points >= HIGHER_FROM;
  const steps = Array.from({ length: SEGMENTS }, (_, index) => {
    const start = 180 + index * SEGMENT_DEGREES + GAP_DEGREES / 2;
    const end = 180 + (index + 1) * SEGMENT_DEGREES - GAP_DEGREES / 2;
    const from = pointOn(start, RADIUS);
    const to = pointOn(end, RADIUS);
    const higher = index + 1 >= HIGHER_FROM;
    const filled = index + 1 <= points;
    const color = filled ? (higher ? colors.flag : colors.accent) : higher ? colors.flagBg : colors.surface3;
    return {
      index,
      color,
      path: `M${from.x.toFixed(2)} ${from.y.toFixed(2)}A${RADIUS} ${RADIUS} 0 0 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`,
    };
  });
  const markerAngle = 180 + (HIGHER_FROM - 1) * SEGMENT_DEGREES;
  const markerFrom = pointOn(markerAngle, RADIUS - STROKE / 2 - 1);
  const markerTo = pointOn(markerAngle, RADIUS + STROKE / 2 + 18);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: '100%', maxWidth: WIDTH, aspectRatio: WIDTH / HEIGHT, alignSelf: 'center' }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {steps.map(({ index, color, path }) => (
          <Path key={index} d={path} fill="none" stroke={color} strokeWidth={STROKE} />
        ))}
        <Line
          x1={markerFrom.x}
          y1={markerFrom.y}
          x2={markerTo.x}
          y2={markerTo.y}
          stroke={colors.flag}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <SvgText
          x={markerTo.x + 6}
          y={markerTo.y + 4}
          alignmentBaseline="middle"
          fontSize={12}
          fontWeight="600"
          fill={colors.flag}
        >
          {higherLabel}
        </SvgText>
        <SvgText
          x={pointOn(180 + SEGMENT_DEGREES / 2, RADIUS).x}
          y={164}
          textAnchor="middle"
          fontSize={12}
          fill={colors.textDim}
        >
          {lowerEnd}
        </SvgText>
        <SvgText
          x={pointOn(360 - SEGMENT_DEGREES / 2, RADIUS).x}
          y={164}
          textAnchor="middle"
          fontSize={12}
          fill={colors.textDim}
        >
          {higherEnd}
        </SvgText>
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${(72 / HEIGHT) * 100}%`,
          alignItems: 'center',
        }}
      >
        <AppText
          importantForAccessibility="no"
          style={{
            fontSize: 60,
            lineHeight: 62,
            fontWeight: '700',
            letterSpacing: -1,
            color: flagged ? colors.flag : colors.text,
          }}
        >
          {String(points)}
        </AppText>
        <AppText
          importantForAccessibility="no"
          variant="caption"
          tone="textDim"
          style={{ fontWeight: '600' }}
        >
          {pointsWord}
        </AppText>
      </View>
    </View>
  );
}

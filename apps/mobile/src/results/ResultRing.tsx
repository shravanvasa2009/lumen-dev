import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const TICK_COUNT = 90;
// Starts a hair left of 12 o'clock so the first tick sits centred on the top.
const START_DEGREES = -90.6;
const TICK_LENGTH = 8;
const EDGE_GAP = 4;

type ResultRingProps = {
  value: string;
  unit: string;
  label: string;
  flagged?: boolean;
  // How much of the ring is lit, 0 to 1. A finished reading is a full ring.
  progress?: number;
  // The Inconclusive screen's larger ring: a smaller number, and longer marks at each third of the target and
  // where the clean seconds stopped.
  large?: boolean;
};

// A value inside a ring of 90 ticks. Results show the heart rate in a full ring; the Inconclusive screen shows
// the clean seconds gathered against the seconds needed.
export function ResultRing({
  value,
  unit,
  label,
  flagged = false,
  progress = 1,
  large = false,
}: ResultRingProps) {
  const { colors } = useTheme();
  const size = large ? 180 : 156;
  const center = size / 2;
  const outer = center - EDGE_GAP;
  const inner = outer - TICK_LENGTH;
  const share = Math.min(1, Math.max(0, progress));
  const lit = Math.round(share * TICK_COUNT);
  const point = (degrees: number, radius: number) => ({
    x: center + radius * Math.cos((degrees * Math.PI) / 180),
    y: center + radius * Math.sin((degrees * Math.PI) / 180),
  });
  const mark = (degrees: number, color: string, width: number, key: string) => {
    const from = point(degrees, inner - 3);
    const to = point(degrees, outer + 3);
    return (
      <Line
        key={key}
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {Array.from({ length: TICK_COUNT }, (_, index) => {
          const degrees = START_DEGREES + (index * 360) / TICK_COUNT;
          const from = point(degrees, inner);
          const to = point(degrees, outer);
          return (
            <Line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={index < lit ? (flagged ? colors.flag : colors.accent) : colors.line2}
              strokeWidth={large ? 1.75 : 1.5}
              strokeLinecap="round"
            />
          );
        })}
        {large
          ? [
              ...[0, 120, 240].map((turn) => mark(-90 + turn, colors.textDim, 2, `third-${turn}`)),
              ...(share > 0 && share < 1 ? [mark(-90 + share * 360, colors.flag, 2.5, 'stopped')] : []),
            ]
          : null}
      </Svg>
      <AppText importantForAccessibility="no" variant={large ? 'vitalL' : 'vitalXL'}>
        {value}
      </AppText>
      <AppText
        importantForAccessibility="no"
        variant={large ? 'caption' : 'subheadline'}
        tone="textDim"
        style={{ fontWeight: large ? '400' : '500', textAlign: 'center', maxWidth: large ? 124 : 104 }}
      >
        {unit}
      </AppText>
    </View>
  );
}

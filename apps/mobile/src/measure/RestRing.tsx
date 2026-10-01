import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const SIZE = 200;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type RestRingProps = {
  // 0 to 1: how much of the rest has passed; the arc grows clockwise from the top.
  elapsed: number;
  clock: string;
  caption: string;
};

export function RestRing({ elapsed, clock, caption }: RestRingProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${clock}. ${caption}`}
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={colors.surface3}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={colors.accent}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE * elapsed} ${CIRCUMFERENCE}`}
          rotation={-90}
          origin={`${SIZE / 2}, ${SIZE / 2}`}
        />
      </Svg>
      <AppText variant="display">{clock}</AppText>
      <AppText tone="textDim">{caption}</AppText>
    </View>
  );
}

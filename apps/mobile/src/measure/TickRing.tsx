import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg from 'react-native-svg';

import { useTheme } from '@/theme';

import { LitTicks } from './LitTicks';

// Finer ticks keep a small ring's centre roomy enough for its two lines.
const TICKS = { regular: { length: 6, gap: 3 }, compact: { length: 4, gap: 2 } };
const EDGE_INSET = 2;

type TickRingProps = {
  // Outer size, ticks included.
  size: number;
  count: number;
  lit: number;
  majorEvery: number;
  // The lit ticks turn to the flag colour while a count is held.
  paused?: boolean;
  compact?: boolean;
  // Drawn inside the ticks, at the size left by TICK_BAND.
  children: (innerSize: number) => ReactNode;
};

// Timer ticks around a progress ring: one per unit of the count, the elapsed ones lit.
export function TickRing({
  size,
  count,
  lit,
  majorEvery,
  paused = false,
  compact = false,
  children,
}: TickRingProps) {
  const { colors } = useTheme();
  const { length, gap } = compact ? TICKS.compact : TICKS.regular;
  const innerSize = size - 2 * (length + gap);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <LitTicks
          center={size / 2}
          outerRadius={size / 2 - EDGE_INSET}
          length={length}
          count={count}
          lit={lit}
          litColor={paused ? colors.flag : colors.accent}
          majorEvery={majorEvery}
          color={colors.line2}
          majorColor={colors.glyph}
        />
      </Svg>
      {children(innerSize)}
    </View>
  );
}

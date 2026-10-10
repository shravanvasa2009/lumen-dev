import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ValueSettle } from '@/components/Reveal';
import { ProgressRing } from '@/onboarding/practiceParts';

import { TickRing } from './TickRing';

const SIZE = 216;
const TICK_COUNT = 60;
const STROKE = 10;

type RestRingProps = {
  // 0 to 1: how much of the rest has passed; the arc grows clockwise from the top.
  elapsed: number;
  clock: string;
  caption: string;
};

export function RestRing({ elapsed, clock, caption }: RestRingProps) {
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${clock}. ${caption}`}
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ position: 'absolute' }}>
        <TickRing
          size={SIZE}
          count={TICK_COUNT}
          lit={Math.round(elapsed * TICK_COUNT)}
          majorEvery={TICK_COUNT / 4}
        >
          {(innerSize) => <ProgressRing fraction={elapsed} size={innerSize} strokeWidth={STROKE} />}
        </TickRing>
      </View>
      <ValueSettle value={clock}>
        <AppText variant="display">{clock}</AppText>
      </ValueSettle>
      <AppText tone="textDim">{caption}</AppText>
    </View>
  );
}

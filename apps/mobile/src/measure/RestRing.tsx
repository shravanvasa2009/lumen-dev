import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ValueSettle } from '@/components/Reveal';
import { ProgressRing } from '@/onboarding/practiceParts';

const SIZE = 200;
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
        <ProgressRing fraction={elapsed} size={SIZE} strokeWidth={STROKE} />
      </View>
      <ValueSettle value={clock}>
        <AppText variant="display">{clock}</AppText>
      </ValueSettle>
      <AppText tone="textDim">{caption}</AppText>
    </View>
  );
}

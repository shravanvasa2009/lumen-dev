import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { motion } from '@/theme/motion';

import type { StepState } from './analysisProgress';

const MARK = 22;

// A step's mark fades in when its state changes; the key remounts it so the new mark is what animates.
function StepMark({ state }: { state: StepState }) {
  return (
    <Animated.View key={state} entering={FadeIn.duration(motion.fadeMs).reduceMotion(ReduceMotion.System)}>
      <StepGlyph state={state} />
    </Animated.View>
  );
}

function StepGlyph({ state }: { state: StepState }) {
  const { colors } = useTheme();
  if (state === 'done') return <Icon name="check" size={MARK} color={colors.accent} />;
  const tint = state === 'active' ? colors.accent : colors.textDim;
  return (
    <Svg
      width={MARK}
      height={MARK}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle cx={12} cy={12} r={8} stroke={tint} strokeWidth={2} fill="none" />
      {state === 'active' ? <Path d="M12 4a8 8 0 0 1 0 16Z" fill={tint} /> : null}
    </Svg>
  );
}

type StepRowProps = {
  label: string;
  state: StepState;
  stateLabel: string;
  // Right-aligned note, such as the rejected-beat count.
  note?: string;
  last: boolean;
};

export function StepRow({ label, state, stateLabel, note, last }: StepRowProps) {
  const { colors, spacing } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}${note ? `, ${note}` : ''}. ${stateLabel}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <StepMark state={state} />
      <AppText style={{ flex: 1 }} tone={state === 'pending' ? 'textDim' : 'text'}>
        {label}
      </AppText>
      {note ? <AppText tone="textDim">{note}</AppText> : null}
    </View>
  );
}

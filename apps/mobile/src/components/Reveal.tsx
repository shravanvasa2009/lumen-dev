import { type ReactNode, useContext, useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  enterTransition,
  exitTransition,
  glideConfig,
  motion,
  settleTransition,
  StillMotion,
  useReduceMotion,
} from '@/theme/motion';

type RevealProps = {
  children: ReactNode;
  // Position among the sections that appear together; later ones start a little later.
  index?: number;
  // Neighbours slide into the space this leaves or fills. Only for one small item at a time (a banner, a
  // collapsible): on a long list the layout pass costs frames on a budget phone.
  settle?: boolean;
  style?: StyleProp<ViewStyle>;
};

// The capture screen sets StillMotion: nothing under it moves except the progress ring (ADR 0075, 0101), so the
// helpers below render as plain views there.
function useStill() {
  const reduceMotion = useReduceMotion();
  return { reduceMotion, still: useContext(StillMotion) };
}

// Content that appears or goes while a screen is open: it fades in and out.
export function Reveal({ children, index = 0, settle = false, style }: RevealProps) {
  const { reduceMotion, still } = useStill();
  return (
    <Animated.View
      entering={still ? undefined : enterTransition(reduceMotion, index)}
      exiting={still ? undefined : exitTransition(reduceMotion)}
      layout={still || !settle ? undefined : settleTransition(reduceMotion)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

// A block that only moves when something above it appears or goes.
export function Settle({ children, style }: Pick<RevealProps, 'children' | 'style'>) {
  const { reduceMotion, still } = useStill();
  return (
    <Animated.View layout={still ? undefined : settleTransition(reduceMotion)} style={style}>
      {children}
    </Animated.View>
  );
}

// Wraps a readout that changes about once a second (the clean-seconds count, a percentage): the new value
// rises into place over the glide time instead of snapping. It runs on the UI thread; nothing re-renders per frame.
export function ValueSettle({
  value,
  children,
  style,
}: { value: string | number | boolean } & Pick<RevealProps, 'children' | 'style'>) {
  const { reduceMotion, still } = useStill();
  const progress = useSharedValue(1);
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    if (still) return;
    progress.value = 0;
    progress.value = withTiming(1, glideConfig(reduceMotion));
  }, [value, still, reduceMotion, progress]);
  const settle = useAnimatedStyle(() => ({
    opacity: motion.settleFromOpacity + (1 - motion.settleFromOpacity) * progress.value,
    transform: [{ translateY: motion.settleRiseDp * (1 - progress.value) }],
  }));
  return <Animated.View style={still ? style : [style, settle]}>{children}</Animated.View>;
}

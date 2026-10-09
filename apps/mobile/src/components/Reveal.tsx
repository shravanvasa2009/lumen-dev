import { type ReactNode, useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  enterTransition,
  exitTransition,
  glideConfig,
  motion,
  settleTransition,
  useReduceMotion,
} from '@/theme/motion';

type RevealProps = {
  children: ReactNode;
  // Position among the sections that appear together; later ones start a little later.
  index?: number;
  style?: StyleProp<ViewStyle>;
};

// Content that appears or goes while a screen is open: it fades in and out, and its neighbours slide into the
// space instead of jumping.
export function Reveal({ children, index = 0, style }: RevealProps) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={enterTransition(reduceMotion, index)}
      exiting={exitTransition(reduceMotion)}
      layout={settleTransition(reduceMotion)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

// A block that only moves when something above it appears or goes.
export function Settle({ children, style }: Omit<RevealProps, 'index'>) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View layout={settleTransition(reduceMotion)} style={style}>
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
}: { value: string | number | boolean } & Omit<RevealProps, 'index'>) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(1);
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    progress.value = 0;
    progress.value = withTiming(1, glideConfig(reduceMotion));
  }, [value, reduceMotion, progress]);
  const settle = useAnimatedStyle(() => ({
    opacity: motion.settleFromOpacity + (1 - motion.settleFromOpacity) * progress.value,
    transform: [{ translateY: motion.settleRiseDp * (1 - progress.value) }],
  }));
  return <Animated.View style={[style, settle]}>{children}</Animated.View>;
}

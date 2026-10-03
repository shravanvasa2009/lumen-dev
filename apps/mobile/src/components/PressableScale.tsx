import type { ComponentProps } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion, useReduceMotion } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// A Pressable that shrinks slightly while held. The spring runs on the UI thread, so it stays smooth while
// the JS thread is busy, and it never delays onPress. With Reduce Motion on it does not move.
type PressableScaleProps = Omit<ComponentProps<typeof Pressable>, 'style'> & { style?: StyleProp<ViewStyle> };

export function PressableScale({ onPressIn, onPressOut, style, ...pressableProps }: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const shrink = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const settleTo = (target: number) => {
    scale.value = withSpring(reduceMotion ? 1 : target, motion.pressSpring);
  };
  return (
    <AnimatedPressable
      {...pressableProps}
      onPressIn={(event) => {
        settleTo(motion.pressScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        settleTo(1);
        onPressOut?.(event);
      }}
      style={[style, shrink]}
    />
  );
}

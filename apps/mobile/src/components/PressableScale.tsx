import { type ComponentProps, useContext } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion, StillMotion, useReduceMotion } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// A Pressable that shrinks slightly while held. The spring runs on the UI thread, so it stays smooth while
// the JS thread is busy, and it never delays onPress. It does not move with Reduce Motion on or on the capture screen (ADR 0075).
type PressableScaleProps = Omit<ComponentProps<typeof Pressable>, 'style'> & { style?: StyleProp<ViewStyle> };

export function PressableScale({ onPressIn, onPressOut, style, ...pressableProps }: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const onCaptureScreen = useContext(StillMotion);
  const still = reduceMotion || onCaptureScreen;
  const scale = useSharedValue(1);
  const shrink = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const settleTo = (target: number) => {
    scale.value = withSpring(still ? 1 : target, motion.pressSpring);
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

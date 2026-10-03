import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme';
import { motion, useReduceMotion } from '@/theme/motion';

type ToggleProps = {
  label: string;
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
};

// Drawn instead of the platform Switch: Android's Material switch renders a small thumb and an
// off-centre track, while the mockups show one 46x28 pill on both platforms.
const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const DISABLED_OPACITY = 0.5;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 2 * THUMB_INSET;

export function Toggle({ label, value, onValueChange, disabled = false }: ToggleProps) {
  const { colors, radius, control } = useTheme();
  // The pill is 28 pt tall; the touch area grows to the minimum target without changing the drawing.
  const touchSlop = (control.minTarget - TRACK_HEIGHT) / 2;
  const reduceMotion = useReduceMotion();
  const timing = { duration: reduceMotion ? 0 : motion.fadeMs };
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? colors.accent : colors.surface3, timing),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? colors.surface : colors.textDim, timing),
    transform: [{ translateX: withTiming(value ? THUMB_TRAVEL : 0, timing) }],
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={touchSlop}
      onPress={() => onValueChange?.(!value)}
      style={[styles.track, { borderRadius: radius.pill, opacity: disabled ? DISABLED_OPACITY : 1 }]}
    >
      <Animated.View style={[styles.fill, { borderRadius: radius.pill }, trackStyle]} />
      <Animated.View style={[styles.thumb, { marginLeft: THUMB_INSET }, thumbStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: TRACK_WIDTH, height: TRACK_HEIGHT, justifyContent: 'center' },
  fill: StyleSheet.absoluteFill,
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2 },
});

import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

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

export function Toggle({ label, value, onValueChange, disabled = false }: ToggleProps) {
  const { colors, radius, control } = useTheme();
  // The pill is 28 pt tall; the touch area grows to the minimum target without changing the drawing.
  const touchSlop = (control.minTarget - TRACK_HEIGHT) / 2;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={touchSlop}
      onPress={() => onValueChange?.(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? colors.accent : colors.surface3,
          borderRadius: radius.pill,
          opacity: disabled ? DISABLED_OPACITY : 1,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: value ? colors.surface : colors.textDim,
            marginLeft: value ? TRACK_WIDTH - THUMB_SIZE - THUMB_INSET : THUMB_INSET,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: TRACK_WIDTH, height: TRACK_HEIGHT, justifyContent: 'center' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2 },
});

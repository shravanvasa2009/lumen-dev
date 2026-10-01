import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const { colors, radius, control, spacing } = useTheme();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          minHeight: isPrimary ? control.primaryButtonHeight : control.minTarget,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xxl,
          backgroundColor: isPrimary ? colors.accentFill : 'transparent',
          borderColor: isPrimary ? colors.accentFill : colors.line2,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <AppText variant="headline" style={{ color: isPrimary ? colors.onAccentFill : colors.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

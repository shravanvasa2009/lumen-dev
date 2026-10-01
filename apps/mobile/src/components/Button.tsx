import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'critical';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const { colors, radius, control, spacing } = useTheme();
  const isSecondary = variant === 'secondary';
  const fill = variant === 'critical' ? colors.criticalFill : colors.accentFill;
  const onFill = variant === 'critical' ? colors.onCriticalFill : colors.onAccentFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          minHeight: isSecondary ? control.minTarget : control.primaryButtonHeight,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xxl,
          backgroundColor: isSecondary ? 'transparent' : fill,
          borderColor: isSecondary ? colors.line2 : fill,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <AppText variant="headline" style={{ color: isSecondary ? colors.text : onFill }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

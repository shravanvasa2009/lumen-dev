import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

type ButtonProps = {
  label: string;
  onPress: () => void;
  // link is a quiet text button for the dismissive choice under a primary action.
  variant?: 'primary' | 'secondary' | 'link' | 'critical';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const { colors, radius, control, spacing } = useTheme();
  const isQuiet = variant === 'secondary' || variant === 'link';
  const labelColor = variant === 'link' ? colors.accent : variant === 'secondary' ? colors.text : undefined;
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
          minHeight: isQuiet ? control.minTarget : control.primaryButtonHeight,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xxl,
          backgroundColor: isQuiet ? 'transparent' : fill,
          borderColor: variant === 'secondary' ? colors.line2 : isQuiet ? 'transparent' : fill,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <AppText variant="headline" style={{ color: labelColor ?? onFill }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

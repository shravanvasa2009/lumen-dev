import { StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

type ButtonProps = {
  label: string;
  onPress: () => void;
  // secondary is a gray capsule, tint a soft accent capsule, surface a white one for a tinted background, link a
  // quiet text button for the dismissive choice under a primary action, alert the safety-check red, critical the
  // emergency red.
  variant?: 'primary' | 'secondary' | 'tint' | 'surface' | 'link' | 'alert' | 'critical';
  disabled?: boolean;
  icon?: IconName;
  // 48 dp tall instead of 52: for buttons that sit side by side in a short sheet.
  compact?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  compact = false,
}: ButtonProps) {
  const { colors, radius, control, spacing } = useTheme();
  const look = {
    primary: { fill: colors.buttonFill, label: colors.onButtonFill },
    secondary: { fill: colors.surface2, label: colors.text },
    tint: { fill: colors.accentTint, label: colors.accent },
    surface: { fill: colors.surface, label: colors.text },
    link: { fill: 'transparent', label: colors.accent },
    alert: { fill: colors.alertFill, label: colors.onAlertFill },
    critical: { fill: colors.criticalFill, label: colors.onCriticalFill },
  }[variant];
  const isQuiet =
    variant === 'secondary' || variant === 'link' || variant === 'tint' || variant === 'surface';
  // A filled call to action that cannot be pressed turns gray, as the foundations board draws it.
  const grayed = disabled && !isQuiet;
  return (
    <PressableScale
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
          gap: spacing.sm,
          backgroundColor: grayed ? colors.surface2 : look.fill,
          opacity: disabled && !grayed ? 0.5 : 1,
        },
        variant === 'secondary' || variant === 'tint' || variant === 'surface'
          ? { minHeight: compact ? control.primaryButtonHeight - 4 : control.primaryButtonHeight }
          : null,
        variant === 'critical' ? { minHeight: control.primaryButtonHeight + 4 } : null,
      ]}
    >
      {icon ? <Icon name={icon} size={20} color={grayed ? colors.textDim : look.label} /> : null}
      <AppText variant="headline" style={{ color: grayed ? colors.textDim : look.label }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

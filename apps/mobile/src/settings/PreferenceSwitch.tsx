import { Switch } from 'react-native';

import { useTheme } from '@/theme';

type PreferenceSwitchProps = {
  label: string;
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
};

export function PreferenceSwitch({ label, value, onValueChange, disabled = false }: PreferenceSwitchProps) {
  const { colors } = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      trackColor={{ false: colors.surface3, true: colors.accent }}
      ios_backgroundColor={colors.surface3}
      thumbColor={value ? colors.surface : colors.textDim}
    />
  );
}

import { Switch } from 'react-native';

import { useTheme } from '@/theme';

type ToggleProps = {
  label: string;
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
};

export function Toggle({ label, value, onValueChange, disabled = false }: ToggleProps) {
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

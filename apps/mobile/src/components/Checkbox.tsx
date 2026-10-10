import { View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

type CheckboxProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };

export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  const { colors, spacing, radius, control } = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: control.minTarget }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.chip,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderColor: checked ? colors.buttonFill : colors.line2,
          backgroundColor: checked ? colors.buttonFill : 'transparent',
        }}
      >
        {checked ? <Icon name="check" size={control.chevronSize} color={colors.onButtonFill} /> : null}
      </View>
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </PressableScale>
  );
}

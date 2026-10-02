import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

type CheckboxProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };

export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  const { colors, spacing, radius, control } = useTheme();
  return (
    <Pressable
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
          borderRadius: radius.card / 2,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderColor: checked ? colors.accentFill : colors.line2,
          backgroundColor: checked ? colors.accentFill : 'transparent',
        }}
      >
        {checked ? <Icon name="check" size={control.chevronSize} color={colors.onAccentFill} /> : null}
      </View>
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </Pressable>
  );
}

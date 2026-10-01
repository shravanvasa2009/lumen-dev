import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

type SegmentedControlProps<Value extends string> = {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value | null;
  onChange: (value: Value) => void;
};

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<Value>) {
  const { colors, spacing, radius, control } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: spacing.xs,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface2,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: control.minTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.card - spacing.xs,
              backgroundColor: selected ? colors.surface3 : 'transparent',
            }}
          >
            <AppText tone={selected ? 'text' : 'textDim'}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

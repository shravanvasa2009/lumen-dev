import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type Option<Value extends string> = { value: Value; label: string; hint?: string };

type SegmentedProps<Value extends string> = {
  options: readonly Option<Value>[];
  // Null while nothing is chosen yet.
  selected: Value | null;
  label?: string;
  onSelect: (value: Value) => void;
};

export function Segmented<Value extends string>({
  options,
  selected,
  onSelect,
  label,
}: SegmentedProps<Value>) {
  const { colors, control, radius, spacing } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: spacing.xs,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
      }}
    >
      {options.map(({ value, label, hint }) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityHint={hint}
            onPress={() => onSelect(value)}
            style={{
              flex: 1,
              minHeight: control.minTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.card - spacing.xs,
              backgroundColor: isSelected ? colors.surface3 : 'transparent',
            }}
          >
            <AppText variant="headline" tone={isSelected ? 'text' : 'textDim'}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

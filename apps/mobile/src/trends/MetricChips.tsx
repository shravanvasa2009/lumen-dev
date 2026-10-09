import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

type MetricChipsProps<Value extends string> = {
  options: readonly { value: Value; label: string }[];
  selected: Value;
  onSelect: (value: Value) => void;
};

export function MetricChips<Value extends string>({ options, selected, onSelect }: MetricChipsProps<Value>) {
  const { colors, control, radius, spacing } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {options.map(({ value, label }) => {
        const isSelected = value === selected;
        return (
          <PressableScale
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            onPress={() => onSelect(value)}
            style={{
              minHeight: control.minTarget,
              justifyContent: 'center',
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: isSelected ? colors.accent : colors.line,
              backgroundColor: isSelected ? colors.badgeCheckedBg : colors.surface2,
            }}
          >
            <AppText variant="headline" tone={isSelected ? 'accent' : 'text'}>
              {label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

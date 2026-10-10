import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

// The board's pill is 32 pt tall in a 2 pt track; the touch area grows to the 44 pt minimum.
const SEGMENT_HEIGHT = 28;
const TRACK_PADDING = 2;
const TOUCH_SLOP = 8;

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
  const { colors, radius, shadow } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: TRACK_PADDING,
        backgroundColor: colors.surface2,
        borderRadius: SEGMENT_HEIGHT / 2 + TRACK_PADDING,
      }}
    >
      {options.map(({ value, label, hint }) => {
        const isSelected = value === selected;
        return (
          <PressableScale
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityHint={hint}
            hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP }}
            onPress={() => onSelect(value)}
            style={[
              {
                flex: 1,
                minHeight: SEGMENT_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.pill,
                backgroundColor: isSelected ? colors.surface : 'transparent',
              },
              isSelected ? shadow.raised : null,
            ]}
          >
            <AppText variant="caption" style={{ fontWeight: isSelected ? '600' : '500' }}>
              {label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

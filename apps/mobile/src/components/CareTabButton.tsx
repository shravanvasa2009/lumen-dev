import type { GestureResponderEvent } from 'react-native';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

type CareTabButtonProps = {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: ((event: GestureResponderEvent) => void) | null;
  testID?: string;
};

const CIRCLE = 52;
const RING = 4;
// Android only delivers touches inside the parent's bounds, so the lift is small enough that most of the
// circle stays inside the bar.
const LIFT = 14;

export function CareTabButton({
  label,
  accessibilityLabel,
  selected,
  onPress,
  onLongPress,
  testID,
}: CareTabButtonProps) {
  const { colors, control } = useTheme();
  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={{ flex: 1, alignItems: 'center', minHeight: control.minTarget }}
    >
      <View
        style={{
          width: CIRCLE + RING * 2,
          height: CIRCLE + RING * 2,
          marginTop: -LIFT - RING,
          borderRadius: (CIRCLE + RING * 2) / 2,
          borderWidth: RING,
          borderColor: colors.surface,
          backgroundColor: colors.accentFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="care" size={28} color={colors.onAccentFill} />
      </View>
      <AppText variant="caption" tone="accent" style={{ fontWeight: selected ? '700' : '500' }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

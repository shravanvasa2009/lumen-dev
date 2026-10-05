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
// Part of the circle that sits inside the bar: the circle with its ring, less the lift and one ring width.
const CIRCLE_IN_ROW = CIRCLE + RING * 2 - LIFT - RING;
// Space between the circle and the label line so the two do not touch.
const LABEL_GAP = 6;

// The tab row must hold the raised circle's visible part plus the label. The demo bar removes the bottom
// inset the bar would otherwise get, so this height is set outright instead of left to the default.
// The label's line height grows with the system font size, so the row grows with it (66 dp at scale 1).
export function tabRowHeight(labelLineHeight: number, fontScale: number): number {
  return CIRCLE_IN_ROW + LABEL_GAP + Math.ceil(labelLineHeight * fontScale);
}

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

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

// MapLibre is a native view that Jest cannot load. This stand-in keeps the props the Care map tests read:
// the style URL and the attribution switch on the map, and each pin's press handler (called with the event
// the test passes to fireEvent.press).
export function Map({
  children,
  mapStyle,
  attribution,
}: {
  children?: ReactNode;
  mapStyle: string;
  attribution?: boolean;
}) {
  return (
    <View
      testID="care-map-view"
      accessibilityLabel={mapStyle}
      accessibilityHint={`attribution:${attribution}`}
    >
      {children}
    </View>
  );
}

export function Camera() {
  return null;
}

export function Marker({
  children,
  id,
  onPress,
}: {
  children: ReactNode;
  id?: string;
  onPress?: (event: { stopPropagation: () => void }) => void;
}) {
  return (
    <Pressable testID={`pin-${id}`} onPress={(event) => onPress?.(event)}>
      {children}
    </Pressable>
  );
}

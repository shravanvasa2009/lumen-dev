import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

// MapLibre is a native view that Jest cannot load. This stand-in keeps the props the Care map tests read:
// the style URL on the map, and each pin's press handler.
export function Map({ children, mapStyle }: { children?: ReactNode; mapStyle: string }) {
  return (
    <View testID="care-map-view" accessibilityLabel={mapStyle}>
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
    <Pressable testID={`pin-${id}`} onPress={() => onPress?.({ stopPropagation: jest.fn() })}>
      {children}
    </Pressable>
  );
}

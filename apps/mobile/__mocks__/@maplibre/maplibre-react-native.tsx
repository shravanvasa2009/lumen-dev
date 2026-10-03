import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

// MapLibre is a native view that Jest cannot load. This stand-in keeps the props the Care map tests read:
// the style URL, the attribution switch, the camera centre and the load events on the map (spread onto the View, which has no
// such props), and each pin's press handler (called with the event the test passes to fireEvent.press).
export function Map({
  children,
  mapStyle,
  attribution,
  onDidFinishRenderingMap,
  onDidFinishRenderingMapFully,
  onDidFailLoadingMap,
}: {
  children?: ReactNode;
  mapStyle: string;
  attribution?: boolean;
  onDidFinishRenderingMap?: () => void;
  onDidFinishRenderingMapFully?: () => void;
  onDidFailLoadingMap?: () => void;
}) {
  return (
    <View
      testID="care-map-view"
      accessibilityLabel={mapStyle}
      accessibilityHint={`attribution:${attribution}`}
      {...{ onDidFinishRenderingMap, onDidFinishRenderingMapFully, onDidFailLoadingMap }}
    >
      {children}
    </View>
  );
}

// The centre is exposed as the label, so tests can see where the map was moved.
export function Camera({ initialViewState }: { initialViewState?: { center?: [number, number] } }) {
  return <View testID="care-map-camera" accessibilityLabel={JSON.stringify(initialViewState?.center)} />;
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

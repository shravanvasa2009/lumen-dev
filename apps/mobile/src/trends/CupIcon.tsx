import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Cup path on the 24-unit grid shared with the other icons; stroked, with the handle on the right.
export const cupPath = 'M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM16 10h1.5a2 2 0 0 1 0 4H16';

export function CupIcon({ size, color }: { size: number; color: ColorValue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Path d={cupPath} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

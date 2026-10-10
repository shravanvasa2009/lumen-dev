import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const icons = {
  call: 'M5 4h3.5l1.7 4.2-2.1 1.3a11 11 0 0 0 5.4 5.4l1.3-2.1L19 14.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z',
  directions: 'M20 4 4 10.5l6.3 2.2L12.5 19 20 4Z',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z',
  search: 'M16 16l4.5 4.5M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Z',
} as const;

export type ContactIconName = keyof typeof icons;

export function ContactIcon({
  name,
  size,
  color,
}: {
  name: ContactIconName;
  size: number;
  color: ColorValue;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={icons[name]} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

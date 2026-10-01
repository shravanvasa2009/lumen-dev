import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const sunRays =
  'M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8';

const strokes = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM10 20v-5a2 2 0 0 1 4 0v5',
  trends: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  learn: 'M6 3h13v14H7.5A2.5 2.5 0 0 0 5 19.5V4a1 1 0 0 1 1-1ZM7.5 17a2.5 2.5 0 0 0 0 4.5H19',
  settings: sunRays,
  warm: sunRays,
  finger: 'M7 20v-9a5 5 0 0 1 10 0v9',
  elbow: 'M3 19h7l3-8h8M13 11l-3 8',
  cup: 'M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM16 9h2a2 2 0 0 1 0 4h-2',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  warning: 'M12 4 2.5 20h19ZM12 10v5M12 17.6v.4',
} as const;

export type IconName = keyof typeof strokes;

type IconProps = { name: IconName; size: number; color: ColorValue };

export function Icon({ name, size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={strokes[name]} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {name === 'settings' || name === 'warm' ? (
        <Circle cx={12} cy={12} r={3.6} stroke={color} strokeWidth={1.8} />
      ) : null}
    </Svg>
  );
}

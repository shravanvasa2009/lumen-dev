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
  back: 'M15 6l-6 6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  warning: 'M12 4 2.5 20h19ZM12 10v5M12 17.6v.4',
  share: 'M12 15V4M8 8l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  pulse: 'M2 12h5l2-5 3 10 2-5h5',
  bars: 'M5 20V10M10 20V5M15 20V12M20 20V8',
  drop: 'M12 3.5C12 3.5 6 9.7 6 14a6 6 0 0 0 12 0C18 9.7 12 3.5 12 3.5Z',
  standing: 'M12 4.5a1.5 1.5 0 1 0 .01 0M7 9.5h10M12 9.5V15M12 15l-3 5.5M12 15l3 5.5',
  noSignal: 'M2 12h5l2-5 3 10 2-5h3M5 20 19 4',
  lens: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0ZM8.4 12a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0-7.2 0Z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0ZM12 7v5l3 2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6Z',
  hint: 'M12 11v5.5M12 7.6v.4',
  rhythm: 'M2 12h4l2-6 2 12 2-9 2 5 2-2h6',
  breath: 'M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0',
  extraBeat: 'M2 14h4l2-6 2 10 2-4h2l1.5-3 1.5 3H22',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  camera:
    'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM8.5 13.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0Z',
  care: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 7v6M9 10h6',
} as const;

export type IconName = keyof typeof strokes;

type IconProps = {
  name: IconName;
  size: number;
  color: ColorValue;
  // Only the warning triangle takes a mark: it then draws filled, with the exclamation in this colour.
  mark?: ColorValue;
};

export function Icon({ name, size, color, mark }: IconProps) {
  if (name === 'warning' && mark) {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        testID={`icon-${name}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path d="M12 3 22 20.5H2Z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        <Path d="M12 9.5v5M12 17.4v.2" stroke={mark} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      testID={`icon-${name}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={strokes[name]} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {name === 'hint' ? <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} /> : null}
      {name === 'settings' || name === 'warm' ? (
        <Circle cx={12} cy={12} r={3.6} stroke={color} strokeWidth={1.8} />
      ) : null}
    </Svg>
  );
}

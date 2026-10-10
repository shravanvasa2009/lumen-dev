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
  sun: 'M8.25 12a3.75 3.75 0 1 0 7.5 0a3.75 3.75 0 1 0-7.5 0ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  // An index finger pointing up: fingertip, nail and one knuckle crease.
  finger: 'M8.5 21V6.5a3.5 3.5 0 0 1 7 0V21M10.5 9V7a1.5 1.5 0 0 1 3 0v2ZM8.5 15h3M12.5 15h3',
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
  updown: 'M8 9.25 12 5.25l4 4M8 14.75l4 4 4-4',
  dumbbell: 'M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11',
  thermometer: 'M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0ZM12 9v7',
  pill: 'M4.53 14.53 14.53 4.53A3.5 3.5 0 0 1 19.47 9.47L9.47 19.47A3.5 3.5 0 0 1 4.53 14.53ZM9.53 9.53l4.94 4.94',
  calendar:
    'M6.25 5.25h11.5a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6.25a2.5 2.5 0 0 1-2.5-2.5v-10a2.5 2.5 0 0 1 2.5-2.5ZM3.75 9.75h16.5M8 3.25v4M16 3.25v4',
  person:
    'M3.25 12a8.75 8.75 0 1 0 17.5 0a8.75 8.75 0 1 0-17.5 0ZM9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0ZM6.4 18.6a6.5 6.5 0 0 1 11.2 0',
  people:
    'M6 8.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0ZM3.5 19a5.5 5.5 0 0 1 11 0M14.35 9.5a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0ZM15.5 14.1a4.6 4.6 0 0 1 5.25 4.9',
  gauge: 'M4 16.5a8 8 0 1 1 16 0M12 16.5l3.5-5',
  walk: 'M12.75 4.75a1.75 1.75 0 1 0 3.5 0a1.75 1.75 0 1 0-3.5 0ZM8.5 20.25l2.75-5.25 2.75 2.25v3M6.5 10.5l3-2.25h4l2.5 3.25 2.5.75M11.25 15l1.25-6.25',
  scale:
    'M7.75 3.75h8.5a4 4 0 0 1 4 4v8.5a4 4 0 0 1-4 4h-8.5a4 4 0 0 1-4-4v-8.5a4 4 0 0 1 4-4ZM8.25 10a5 5 0 0 1 7.5 0M12 10l1.5-2',
  call: 'M8.4 3.75H6.1a1.85 1.85 0 0 0-1.85 2.05 14.5 14.5 0 0 0 13.95 13.95 1.85 1.85 0 0 0 2.05-1.85v-2.3a1.25 1.25 0 0 0-.95-1.2l-3-.75a1.25 1.25 0 0 0-1.25.4l-1.2 1.4a11 11 0 0 1-5.35-5.35l1.4-1.2a1.25 1.25 0 0 0 .4-1.25l-.75-3a1.25 1.25 0 0 0-1.2-.95Z',
  care: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 7v6M9 10h6',
  bell: 'M6.25 16.5V11a5.75 5.75 0 0 1 11.5 0v5.5l1.5 1.75H4.75ZM10 20.25a2.1 2.1 0 0 0 4 0',
  alarm: 'M4.5 13.25a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0-15 0ZM12 13.25V9.5M9.75 3.25h4.5M18 6.75l1.25-1.25',
  refresh: 'M19.25 12a7.25 7.25 0 1 1-2.1-5.1M19.5 4.25v3.5H16',
  stethoscope:
    'M6.25 3.75H5.5a1.25 1.25 0 0 0-1.25 1.25v4a4.5 4.5 0 0 0 9 0V5a1.25 1.25 0 0 0-1.25-1.25h-.75M8.75 13.5v1.75a4.75 4.75 0 0 0 9.5 0V13M16 10.75a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0-4.5 0Z',
  torch: 'M8 3.75h8v3.5l-1.75 3v10h-4.5v-10L8 7.25ZM8 7.25h8M12 13v2.5',
  lenses:
    'M4.75 8a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0-6.5 0ZM4.75 16a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0-6.5 0ZM13.25 12a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0-6.5 0Z',
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

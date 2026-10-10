import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// A circle written as two arcs, so every icon below is plain path data.
const ring = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const personHead = ring(12, 7.5, 3.5);
const personBody = 'M5 20.25c.6-3.6 3.4-6 7-6s6.4 2.4 7 6';
const cameraBody =
  'M6 7h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 6 7Z';

const icons = {
  camera: [cameraBody, ring(12, 13, 3.25), 'M8.5 7 10 4.5h4L15.5 7'],
  heart: ['M12 20s-7.5-4.6-7.5-10.1A4.15 4.15 0 0 1 12 7.4a4.15 4.15 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z'],
  timer: [ring(12, 13.5, 7), 'M12 13.5V10M10 3.5h4M12 3.5v3'],
  hand: [
    'M8.5 13V6.25a1.5 1.5 0 0 1 3 0V11M11.5 10.5V4.75a1.5 1.5 0 0 1 3 0v5.75M14.5 10.5v-4a1.5 1.5 0 0 1 3 0v7.25a6.25 6.25 0 0 1-6.25 6.25h-.6a5.5 5.5 0 0 1-4.3-2.07L4 15.1a1.5 1.5 0 0 1 2.3-1.9l2.2 2.3',
    'M2.5 6.5c.5-1.2 1.3-2.1 2.4-2.7M20.5 3.8c1 .6 1.7 1.5 2 2.7',
  ],
  press: ['M9.5 13.5V5.25a2.5 2.5 0 0 1 5 0v8.25', 'M12 15.5v3.25M9.75 16.75 12 19l2.25-2.25', 'M4 21h16'],
  cold: ['M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9', 'M9.75 4.75 12 7l2.25-2.25M9.75 19.25 12 17l2.25 2.25'],
  retake: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v4h4'],
  bulb: [
    'M9 17.25h6M10 20.25h4',
    'M12 3.75a5.75 5.75 0 0 0-3.4 10.4c.6.45.9 1 .9 1.6v1.5h5v-1.5c0-.6.3-1.15.9-1.6A5.75 5.75 0 0 0 12 3.75Z',
  ],
  check: ['M5 12.75 9.75 17.5 19 6.75'],
  muted: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5M21 9.5l-5 5'],
  doctor: [personHead, personBody, 'M15.5 16.5v2.25M14.4 17.6h2.25'],
  rhythm: ['M2.5 13h3.25l1.5-4 2 8 1.5-4h1.5l1.25-7 1.75 11 1.25-4h4'],
  report: [
    'M7 3.75h7.5l3.5 3.5v13H7a1.25 1.25 0 0 1-1.25-1.25V5A1.25 1.25 0 0 1 7 3.75Z',
    'M14.5 3.75v3.5H18M9 12.5h1.5l1-2 1.5 4 1-2H15',
  ],
  clock: [ring(12, 12, 8.25), 'M12 7.5V12l3 2'],
  notice: [ring(12, 12, 8.25), 'M12 11v5.25M12 7.75v.01'],
  arrow: ['M5 12h13M13.5 7.5 18 12l-4.5 4.5'],
  vessels: ['M3 9c3-2 6 2 9 0s6-2 9 0M3 15c3-2 6 2 9 0s6-2 9 0'],
  seated: ['M7 3.75v9.5h10M7 13.25 6 20.25M17 13.25l1 7M7 9.25h9'],
  age: [
    ring(9, 6, 2.5),
    'M9 8.5v5.5l-2.5 6.5M9 14l2.5 6.5M9 10.5l-3.5 2.5M9 10.5l4.5 1.5',
    'M16.5 11v9.5',
    'M13.5 12h3',
  ],
  medicine: [
    'M9.361 17.817 18.371 11.507A3.25 3.25 0 0 0 14.639 6.183L5.629 12.493A3.25 3.25 0 0 0 9.361 17.817Z',
    'M10 9.4l3.9 5.4',
  ],
  bloodDrop: [
    'M12 3.5s-6 6.6-6 10.75a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5Z',
    'M9.25 14.5a2.75 2.75 0 0 0 2.75 2.75',
  ],
  phone: [
    'M8.4 3.75H6.1a1.85 1.85 0 0 0-1.85 2.05 14.5 14.5 0 0 0 13.95 13.95 1.85 1.85 0 0 0 2.05-1.85v-2.3a1.25 1.25 0 0 0-.95-1.2l-3-.75a1.25 1.25 0 0 0-1.25.4l-1.2 1.4a11 11 0 0 1-5.35-5.35l1.4-1.2a1.25 1.25 0 0 0 .4-1.25l-.75-3a1.25 1.25 0 0 0-1.2-.95Z',
  ],
} as const;

export type ChapterIconName = keyof typeof icons;

export function ChapterIcon({
  name,
  size,
  color,
  weight = 1.8,
}: {
  name: ChapterIconName;
  size: number;
  color: ColorValue;
  weight?: number;
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
      {icons[name].map((path) => (
        <Path
          key={path}
          d={path}
          stroke={color}
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

function circle(cx: number, cy: number, radius: number): string {
  return `M${cx - radius} ${cy}a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0`;
}

const heart = 'M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z';
const wind = 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7';
const slash = 'M3.5 3.5l17 17';
const phoneBody =
  'M6.5 2.5h11a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5Z';
const tick = 'M5 12.75 9.75 17.5 19 6.75';
const cross = 'M7 7l10 10M17 7 7 17';
const waves = 'M2.5 9c3.5-3 7 3 10.5 0s5.5-1 8.5-1M2.5 15c3.5-3 7 3 10.5 0s5.5-1 8.5-1';

// Paths on a 24-unit grid, drawn the same way as the Icon set so the lesson tiles match the rest of the app.
const glyphs = {
  arrowUp: ['M12 19.5V5M6 11l6-6 6 6'],
  arrowDown: ['M12 4.5V19M6 13l6 6 6-6'],
  bolt: ['M13 3 5 13.5h6L10 21l8-10.5h-6Z'],
  dumbbell: ['M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11'],
  moon: ['M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z'],
  battery: ['M3.5 8h14v8h-14ZM20.5 11v2M6.5 10.5v3'],
  trendDown: ['M3.5 7 9 12.5l3.5-3 8 7.5M15 17h5.5v-5.5'],
  metronome: ['M9 3.5h6l3.5 17h-13Z', 'M12 15 16.5 5.5', 'M7.5 15h9'],
  heart: [heart],
  trendUp: ['M4 19.5h16M5 14l4-4 3.5 3L19 6.5'],
  band: ['M3.5 8.5h17M3.5 15.5h17', circle(7, 12, 1.4), circle(12, 11, 1.4), circle(17, 13, 1.4)],
  clock: [circle(12, 12, 8.5), 'M12 7.5V12l3 2'],
  check: [tick],
  cross: [cross],
  gauge: ['M4.5 16.5a7.5 7.5 0 1 1 15 0', 'M12 16.5l3.5-4.5', circle(12, 16.5, 1.2)],
  pulseCross: ['M12 3.5v17', 'M3.5 9.5 6 12l3.5-4', 'M15 8l4.5 4.5M19.5 8 15 12.5'],
  rhythm: ['M2.5 13h3.25l1.5-4 2 8 1.5-4h1.5l1.25-7 1.75 11 1.25-4h4'],
  bars: ['M5 19.5V11M10 19.5V6M15 19.5V9M20 19.5V13'],
  breath: [wind],
  noPressure: [circle(12, 13.5, 7), 'M12 13.5l3-3M9 4h6', slash],
  noOxygen: ['M12 3.5s6 6.6 6 10.75a6 6 0 0 1-12 0C6 10.1 12 3.5 12 3.5Z', slash],
  noArteries: [waves, slash],
  heartAttack: [heart, 'M12.5 8 10.5 12h3l-2 4'],
  ecg: ['M2.5 12h4l2-5 3 10 2.5-7 1.5 2h6'],
  help: [
    circle(12, 12, 8.5),
    'M9.75 9.5a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1.05.8-1.05 1.5v.3',
    circle(12, 16.6, 0.6),
  ],
  faint: [
    circle(5.5, 15.5, 2),
    'M8.5 16h12M11 16l2-3.5h4',
    'M4 8.5c1-1 2-1 3 0s2 1 3 0M13 6.5c1-1 2-1 3 0s2 1 3 0',
  ],
  phoneOff: [
    'M6.5 2.5h11a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5Z',
    slash,
  ],
  call: [
    'M5 4h3.5l1.75 4.5-2.25 1.5a10 10 0 0 0 6 6l1.5-2.25L20 15.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4Z',
  ],
  ladder: ['M7 3.5v17M17 3.5v17M7 8h10M7 13h10M7 18h10'],
  place: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z', circle(12, 10, 2.25)],
  screens: [phoneBody, 'M9 12h1.5l1-2.5 1.5 5 1-2.5H15'],
  visit: [
    'M5.5 5h13a3 3 0 0 1 3 3v9.5a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z',
    'M3.5 10h17M8 3v4M16 3v4',
    'M9 15l2 2 4-4',
  ],
  stethoscope: ['M6 3.5v5a4 4 0 0 0 8 0v-5', 'M10 12.5v2a4.5 4.5 0 0 0 9 0v-1.5', circle(19, 11, 2)],
  stroke: [circle(12, 12, 8.5), 'M9 10h.01M15 10h.01', 'M8.5 15.5c1.5-.6 3.2-.4 4.6.2 1 .4 1.9.9 2.4 1.3'],
  report: [
    'M6.5 2.5h7l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z',
    'M13.5 2.5V7H18M8.5 12h7M8.5 16h5',
  ],
  clinic: ['M3.5 20.5h17M5.5 20.5V9.5L12 4.5l6.5 5v11', 'M12 10v5M9.5 12.5h5'],
  chevron: ['M9 5.5 15.5 12 9 18.5'],
  arrowRight: ['M4 12h14M13 6.5l5.5 5.5-5.5 5.5'],
} as const satisfies Record<string, readonly string[]>;

export type GlyphName = keyof typeof glyphs;

export function LessonGlyph({
  name,
  size,
  color,
  weight = 2,
}: {
  name: GlyphName;
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
      {glyphs[name].map((path) => (
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

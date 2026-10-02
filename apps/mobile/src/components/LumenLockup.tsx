import Svg, { Circle, Defs, G, Mask, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

const WIDTH = 322.95;
const HEIGHT = 88.09;
const PULSE_LINE = 'M12 116 H74 L90 72 L108 152 L122 116 H188';
// Redrawn from assets/brand/lockup-{light,dark}.svg (react-native-svg cannot load a file); the kit's
// colours become theme tokens so one drawing serves both themes.
const WORDMARK =
  'M5.76 0V-46.72H14.85V0ZM13.57 0V-8H33.73V0Z M50.79 1.09Q44.77 1.09 41.48 -2.88Q38.18 -6.85 38.18 -14.66V-34.82H47.08V-13.89Q47.08 -10.69 48.87 -8.8Q50.66 -6.91 53.73 -6.91Q56.8 -6.91 58.76 -8.9Q60.71 -10.88 60.71 -14.27V-34.82H69.6V0H62.56V-14.78H63.27Q63.27 -9.54 61.92 -6.02Q60.58 -2.5 57.89 -0.7Q55.2 1.09 51.17 1.09Z M78.34 0V-34.75H85.38V-19.84H84.74Q84.74 -25.09 86.09 -28.64Q87.43 -32.19 90.09 -34.02Q92.74 -35.84 96.71 -35.84H97.1Q101.13 -35.84 103.78 -34.02Q106.44 -32.19 107.75 -28.64Q109.06 -25.09 109.06 -19.84H106.82Q106.82 -25.09 108.2 -28.64Q109.58 -32.19 112.23 -34.02Q114.89 -35.84 118.86 -35.84H119.24Q123.27 -35.84 125.96 -34.02Q128.65 -32.19 130.02 -28.64Q131.4 -25.09 131.4 -19.84V0H122.5V-20.67Q122.5 -23.94 120.84 -25.89Q119.18 -27.84 116.1 -27.84Q113.03 -27.84 111.18 -25.82Q109.32 -23.81 109.32 -20.42V0H100.42V-20.67Q100.42 -23.94 98.76 -25.89Q97.1 -27.84 94.02 -27.84Q90.95 -27.84 89.1 -25.82Q87.24 -23.81 87.24 -20.42V0Z M154.99 1.22Q150.51 1.22 147.15 -0.32Q143.79 -1.86 141.58 -4.45Q139.37 -7.04 138.25 -10.24Q137.13 -13.44 137.13 -16.77V-17.98Q137.13 -21.44 138.25 -24.67Q139.37 -27.9 141.58 -30.43Q143.79 -32.96 147.05 -34.46Q150.32 -35.97 154.6 -35.97Q160.24 -35.97 164.04 -33.5Q167.85 -31.04 169.77 -27.04Q171.69 -23.04 171.69 -18.43V-15.23H140.91V-20.67H166.12L163.37 -17.98Q163.37 -21.31 162.41 -23.68Q161.45 -26.05 159.5 -27.33Q157.55 -28.61 154.6 -28.61Q151.66 -28.61 149.61 -27.26Q147.56 -25.92 146.51 -23.39Q145.45 -20.86 145.45 -17.34Q145.45 -14.08 146.48 -11.55Q147.5 -9.02 149.61 -7.58Q151.72 -6.14 154.99 -6.14Q158.25 -6.14 160.3 -7.46Q162.35 -8.77 162.92 -10.69H171.12Q170.35 -7.1 168.17 -4.42Q166 -1.73 162.64 -0.26Q159.28 1.22 154.99 1.22Z M177.62 0V-34.75H184.66V-19.84H184.02Q184.02 -25.15 185.42 -28.7Q186.83 -32.26 189.62 -34.05Q192.4 -35.84 196.56 -35.84H196.94Q203.15 -35.84 206.35 -31.84Q209.55 -27.84 209.55 -19.9V0H200.66V-20.67Q200.66 -23.87 198.83 -25.86Q197.01 -27.84 193.81 -27.84Q190.54 -27.84 188.53 -25.82Q186.51 -23.81 186.51 -20.42V0Z';

export function LumenLockup({ width }: { width: number }) {
  const { colors } = useTheme();
  return (
    <Svg
      width={width}
      height={(width * HEIGHT) / WIDTH}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      accessibilityElementsHidden
    >
      <G transform="translate(0,4) scale(0.40046)">
        <Defs>
          <Mask id="lockup-cutout" maskUnits="userSpaceOnUse" x={0} y={0} width={200} height={200}>
            <Rect width={200} height={200} fill="#fff" />
            <Path
              d={PULSE_LINE}
              fill="none"
              stroke="#000"
              strokeWidth={26}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Mask>
        </Defs>
        <G mask="url(#lockup-cutout)">
          <Rect
            x={60}
            y={16}
            width={80}
            height={168}
            rx={22}
            fill="none"
            stroke={colors.accent}
            strokeWidth={10}
          />
        </G>
        <Circle cx={84} cy={42} r={7} fill={colors.accent} />
        <Path
          d={PULSE_LINE}
          fill="none"
          stroke={colors.text}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
      <Path transform="translate(104.92,67.41)" d={WORDMARK} fill={colors.text} />
    </Svg>
  );
}

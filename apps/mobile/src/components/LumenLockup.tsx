import Svg, { Circle, Defs, G, Mask, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

const WORDMARK =
  'M5.76 0V-46.72H14.85V0ZM13.57 0V-8H33.73V0Z M50.79 1.09Q44.77 1.09 41.48 -2.88Q38.18 -6.85 38.18 -14.66V-34.82H47.08V-13.89Q47.08 -10.69 48.87 -8.8Q50.66 -6.91 53.73 -6.91Q56.8 -6.91 58.76 -8.9Q60.71 -10.88 60.71 -14.27V-34.82H69.6V0H62.56V-14.78H63.27Q63.27 -9.54 61.92 -6.02Q60.58 -2.5 57.89 -0.7Q55.2 1.09 51.17 1.09Z M78.34 0V-34.75H85.38V-19.84H84.74Q84.74 -25.09 86.09 -28.64Q87.43 -32.19 90.09 -34.02Q92.74 -35.84 96.71 -35.84H97.1Q101.13 -35.84 103.78 -34.02Q106.44 -32.19 107.75 -28.64Q109.06 -25.09 109.06 -19.84H106.82Q106.82 -25.09 108.2 -28.64Q109.58 -32.19 112.23 -34.02Q114.89 -35.84 118.86 -35.84H119.24Q123.27 -35.84 125.96 -34.02Q128.65 -32.19 130.02 -28.64Q131.4 -25.09 131.4 -19.84V0H122.5V-20.67Q122.5 -23.94 120.84 -25.89Q119.18 -27.84 116.1 -27.84Q113.03 -27.84 111.18 -25.82Q109.32 -23.81 109.32 -20.42V0H100.42V-20.67Q100.42 -23.94 98.76 -25.89Q97.1 -27.84 94.02 -27.84Q90.95 -27.84 89.1 -25.82Q87.24 -23.81 87.24 -20.42V0Z M154.99 1.22Q150.51 1.22 147.15 -0.32Q143.79 -1.86 141.58 -4.45Q139.37 -7.04 138.25 -10.24Q137.13 -13.44 137.13 -16.77V-17.98Q137.13 -21.44 138.25 -24.67Q139.37 -27.9 141.58 -30.43Q143.79 -32.96 147.05 -34.46Q150.32 -35.97 154.6 -35.97Q160.24 -35.97 164.04 -33.5Q167.85 -31.04 169.77 -27.04Q171.69 -23.04 171.69 -18.43V-15.23H140.91V-20.67H166.12L163.37 -17.98Q163.37 -21.31 162.41 -23.68Q161.45 -26.05 159.5 -27.33Q157.55 -28.61 154.6 -28.61Q151.66 -28.61 149.61 -27.26Q147.56 -25.92 146.51 -23.39Q145.45 -20.86 145.45 -17.34Q145.45 -14.08 146.48 -11.55Q147.5 -9.02 149.61 -7.58Q151.72 -6.14 154.99 -6.14Q158.25 -6.14 160.3 -7.46Q162.35 -8.77 162.92 -10.69H171.12Q170.35 -7.1 168.17 -4.42Q166 -1.73 162.64 -0.26Q159.28 1.22 154.99 1.22Z M177.62 0V-34.75H184.66V-19.84H184.02Q184.02 -25.15 185.42 -28.7Q186.83 -32.26 189.62 -34.05Q192.4 -35.84 196.56 -35.84H196.94Q203.15 -35.84 206.35 -31.84Q209.55 -27.84 209.55 -19.9V0H200.66V-20.67Q200.66 -23.87 198.83 -25.86Q197.01 -27.84 193.81 -27.84Q190.54 -27.84 188.53 -25.82Q186.51 -23.81 186.51 -20.42V0Z';

// The app tile is 88 units square; the phone glyph inside is drawn on a 200 unit grid and scaled to 68% of the tile.
const TILE = 88;
const TILE_RADIUS = 19.69;
const GLYPH_SCALE = 0.34;
const GLYPH_OFFSET = (TILE - 200 * GLYPH_SCALE) / 2;
// The wordmark's own box is 208 x 50 units starting at (4, -48); it is scaled up beside the tile.
const WORD_SCALE_BESIDE = 1.2;
const WORD_GAP_BESIDE = 20;
const WORD_GAP_BELOW = 20;
const WORD_LEFT = 4;
const WORD_TOP = -48;
const WORD_WIDTH = 208;
const WORD_HEIGHT = 50;
// Distance from the wordmark baseline up to the middle of its box, used to centre it on the tile.
const WORD_CENTER_ABOVE_BASELINE = -(WORD_TOP + WORD_HEIGHT / 2);
const BESIDE_WIDTH = TILE + WORD_GAP_BESIDE + WORD_WIDTH * WORD_SCALE_BESIDE;
const BELOW_HEIGHT = TILE + WORD_GAP_BELOW + WORD_HEIGHT;

// The tile takes the button colour with a white glyph on a light screen, and the bright teal with a near-black
// glyph on a dark one, so the mark never sits as a black icon on bright teal on white.
function AppTile({ x, y }: { x: number; y: number }) {
  const { colors, isDark } = useTheme();
  const tile = isDark ? colors.accentFill : colors.buttonFill;
  const glyph = isDark ? colors.onAccentFill : colors.onButtonFill;
  return (
    <G transform={`translate(${x},${y})`}>
      <Rect width={TILE} height={TILE} rx={TILE_RADIUS} fill={tile} />
      <G transform={`translate(${GLYPH_OFFSET},${GLYPH_OFFSET}) scale(${GLYPH_SCALE})`}>
        <Defs>
          <Mask id="lumen-tile-cutout" maskUnits="userSpaceOnUse" x={0} y={0} width={200} height={200}>
            <Rect width={200} height={200} fill="#fff" />
            <Circle cx={82} cy={40} r={7} fill="#000" />
            <Path
              d="M56 116H80L94 76L110 150L122 116H144"
              fill="none"
              stroke="#000"
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Mask>
        </Defs>
        <Rect x={56} y={14} width={88} height={172} rx={24} fill={glyph} mask="url(#lumen-tile-cutout)" />
      </G>
    </G>
  );
}

export function LumenAppIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${TILE} ${TILE}`} accessibilityElementsHidden>
      <AppTile x={0} y={0} />
    </Svg>
  );
}

// `stacked` puts the wordmark under the tile (Welcome); otherwise it sits beside it. `width` is the whole drawing.
export function LumenLockup({ width, stacked = false }: { width: number; stacked?: boolean }) {
  const { colors } = useTheme();
  const drawingWidth = stacked ? WORD_WIDTH : BESIDE_WIDTH;
  const drawingHeight = stacked ? BELOW_HEIGHT : TILE;
  const wordmark = stacked
    ? `translate(${-WORD_LEFT},${TILE + WORD_GAP_BELOW - WORD_TOP})`
    : `translate(${TILE + WORD_GAP_BESIDE - WORD_LEFT * WORD_SCALE_BESIDE},${TILE / 2 + WORD_CENTER_ABOVE_BASELINE * WORD_SCALE_BESIDE}) scale(${WORD_SCALE_BESIDE})`;
  return (
    <Svg
      width={width}
      height={(width * drawingHeight) / drawingWidth}
      viewBox={`0 0 ${drawingWidth} ${drawingHeight}`}
      accessibilityElementsHidden
    >
      <AppTile x={stacked ? (WORD_WIDTH - TILE) / 2 : 0} y={0} />
      <Path transform={wordmark} d={WORDMARK} fill={colors.text} />
    </Svg>
  );
}

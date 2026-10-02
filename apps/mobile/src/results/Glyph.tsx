import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const strokes = {
  share: 'M12 15V4M8 8l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  noSignal: 'M2 12h5l2-5 3 10 2-5h3M5 20 19 4',
  hint: 'M12 11v5.5M12 7.6v.4',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

type GlyphProps = {
  name: keyof typeof strokes | 'warning';
  size: number;
  color: ColorValue;
  mark?: ColorValue;
};

// Glyphs the shared Icon set does not have yet. `mark` is the exclamation colour on the warning triangle.
export function Glyph({ name, size, color, mark = color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {name === 'warning' ? (
        <>
          <Path d="M12 3 22 20.5H2Z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          <Path d="M12 9.5v5M12 17.4v.2" stroke={mark} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        <Path
          d={strokes[name]}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {name === 'hint' ? <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} /> : null}
    </Svg>
  );
}

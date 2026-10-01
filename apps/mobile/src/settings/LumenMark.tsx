import type { ColorValue } from 'react-native';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

// The solid phone mark from the brand kit (design/brand/mark-solid.*.svg). The mask colors are luminance
// values for the cut-outs, not theme colors: white keeps the shape, black removes the camera dot and pulse.
export function LumenMark({ size, color }: { size: number; color: ColorValue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" accessibilityElementsHidden>
      <Defs>
        <Mask id="lumen-mark-cutout" maskUnits="userSpaceOnUse" x={0} y={0} width={200} height={200}>
          <Rect width={200} height={200} fill="#fff" />
          <Circle cx={82} cy={40} r={7} fill="#000" />
          <Path
            d="M56 116 H80 L94 76 L110 150 L122 116 H144"
            fill="none"
            stroke="#000"
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Mask>
      </Defs>
      <Rect x={56} y={14} width={88} height={172} rx={24} fill={color} mask="url(#lumen-mark-cutout)" />
    </Svg>
  );
}

import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

type PostureFigureProps = { posture: 'lying' | 'standing'; height: number };

const LYING_BOX = { width: 110, height: 44 };
const STANDING_BOX = { width: 44, height: 92 };
// Only used to shade the figure's own colours; page colours always come from the theme.
const SHADE = 'rgba(0,0,0,0.14)';

// Flat side view of an adult, drawn like the how-to-sit person and from the same illustration tokens.
export function PostureFigure({ posture, height }: PostureFigureProps) {
  const { colors } = useTheme();
  const box = posture === 'lying' ? LYING_BOX : STANDING_BOX;
  const shirt = colors.illustrationTorso;
  const pants = colors.textDim;
  return (
    <Svg
      width={(height * box.width) / box.height}
      height={height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {posture === 'lying' ? (
        <>
          <Rect x={0} y={34} width={110} height={5} rx={2.5} fill={colors.line2} />
          <Rect x={2} y={26} width={22} height={8} rx={4} fill={colors.surface3} />
          <Rect x={22} y={17} width={36} height={17} rx={8} fill={shirt} />
          <Rect x={54} y={19} width={44} height={15} rx={7} fill={pants} />
          <Rect x={94} y={26} width={13} height={8} rx={4} fill={colors.illustrationShoe} />
          <Rect x={30} y={22} width={30} height={7} rx={3.5} fill={SHADE} />
          <Circle cx={14} cy={21} r={8} fill={colors.illustrationSkin} />
          <Path d="M6 20a8 8 0 0 1 14-5.5c-3 0-7 1.500-9 5.500Z" fill={colors.illustrationHair} />
        </>
      ) : (
        <>
          <Rect x={0} y={87} width={44} height={5} rx={2.5} fill={colors.line2} />
          <Rect x={13} y={48} width={8} height={36} rx={4} fill={pants} />
          <Rect x={23} y={48} width={8} height={36} rx={4} fill={pants} />
          <Ellipse cx={19} cy={85} rx={7} ry={3} fill={colors.illustrationShoe} />
          <Ellipse cx={29} cy={85} rx={7} ry={3} fill={colors.illustrationShoe} />
          <Rect x={11} y={20} width={22} height={34} rx={9} fill={shirt} />
          <Rect x={7} y={22} width={7} height={28} rx={3.5} fill={shirt} />
          <Rect x={30} y={22} width={7} height={28} rx={3.5} fill={shirt} />
          <Rect x={7} y={22} width={7} height={28} rx={3.5} fill={SHADE} />
          <Circle cx={7.5} cy={52} r={3.5} fill={colors.illustrationSkin} />
          <Circle cx={33.5} cy={52} r={3.5} fill={colors.illustrationSkin} />
          <Rect x={19} y={14} width={6} height={8} rx={3} fill={colors.illustrationSkin} />
          <Circle cx={22} cy={10} r={8} fill={colors.illustrationSkin} />
          <Path d="M14 9a8 8 0 0 1 16 0c-5-2-11-2-16 0Z" fill={colors.illustrationHair} />
        </>
      )}
    </Svg>
  );
}

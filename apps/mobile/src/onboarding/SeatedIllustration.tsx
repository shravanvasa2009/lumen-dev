import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 190;
const LABEL_SIZE = 12;

type SeatedIllustrationProps = { phoneLabel: string; elbowLabel: string };

// Side view of someone seated at a table with the elbow resting on it and the phone at chest height.
export function SeatedIllustration({ phoneLabel, elbowLabel }: SeatedIllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg
      width="100%"
      height={VIEWBOX_HEIGHT}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect x={20} y={128} width={260} height={10} rx={5} fill={colors.line2} />
      <Rect x={40} y={138} width={10} height={52} fill={colors.surface3} />
      <Rect x={250} y={138} width={10} height={52} fill={colors.surface3} />
      <Circle cx={100} cy={32} r={20} fill={colors.illustrationSkin} />
      <Path
        d="M112 58 Q92 76 96 124"
        stroke={colors.illustrationTorso}
        strokeWidth={18}
        strokeLinecap="round"
        fill="none"
      />
      <Line
        x1={104}
        y1={72}
        x2={130}
        y2={120}
        stroke={colors.illustrationSkin}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <Line
        x1={130}
        y1={120}
        x2={190}
        y2={100}
        stroke={colors.illustrationSkin}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <Circle cx={130} cy={121} r={9} fill="none" stroke={colors.accent} strokeWidth={2.5} />
      <Rect
        x={188}
        y={76}
        width={22}
        height={42}
        rx={5}
        fill={colors.bg}
        stroke={colors.accent}
        strokeWidth={2.5}
      />
      <Circle cx={198} cy={88} r={4} fill={colors.pulse} />
      <SvgText x={218} y={90} fill={colors.accent} fontSize={LABEL_SIZE}>
        {phoneLabel}
      </SvgText>
      <SvgText x={140} y={152} fill={colors.accent} fontSize={LABEL_SIZE}>
        {elbowLabel}
      </SvgText>
    </Svg>
  );
}

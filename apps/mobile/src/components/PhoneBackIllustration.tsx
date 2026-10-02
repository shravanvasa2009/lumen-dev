import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 340;
const FINGER_ANGLE_DEG = 28;
const LABEL_SIZE = 15;

type PhoneBackIllustrationProps = { lensLabel: string; flashLabel: string };

// A generic phone back: one lens beside the flash with a fingertip laid across both. Positions are an
// illustration, not a measured layout for any model (packages/device-db holds placeholders only).
export function PhoneBackIllustration({ lensLabel, flashLabel }: PhoneBackIllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg
      width="100%"
      height={VIEWBOX_HEIGHT}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect
        x={65}
        y={2}
        width={170}
        height={336}
        rx={34}
        fill={colors.surface3}
        stroke={colors.line2}
        strokeWidth={2}
      />
      <Rect
        x={78}
        y={14}
        width={50}
        height={106}
        rx={25}
        fill={colors.surface}
        stroke={colors.line2}
        strokeWidth={1}
      />
      <Circle cx={103} cy={44} r={18} fill={colors.textFaint} />
      <Circle cx={103} cy={94} r={14} fill={colors.bg} />
      <Circle cx={150} cy={44} r={9} fill={colors.flag} opacity={0.5} />
      <G rotation={FINGER_ANGLE_DEG} origin="140, 70">
        <Rect x={50} y={42} width={180} height={56} rx={28} fill={colors.pulse} opacity={0.35} />
      </G>
      <Circle cx={103} cy={44} r={22} fill="none" stroke={colors.accent} strokeWidth={3} />
      <Circle cx={150} cy={44} r={13} fill="none" stroke={colors.flag} strokeWidth={3} />
      <Line x1={42} y1={48} x2={80} y2={44} stroke={colors.accent} strokeWidth={1.5} />
      <SvgText x={4} y={52} fill={colors.accent} fontSize={LABEL_SIZE} fontWeight="600">
        {lensLabel}
      </SvgText>
      <Line x1={163} y1={44} x2={236} y2={38} stroke={colors.flag} strokeWidth={1.5} />
      <SvgText x={242} y={44} fill={colors.flag} fontSize={LABEL_SIZE} fontWeight="600">
        {flashLabel}
      </SvgText>
    </Svg>
  );
}

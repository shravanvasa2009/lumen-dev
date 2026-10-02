import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 340;
const FINGER_ANGLE_DEG = 28;
const LABEL_SIZE = 15;
const HALO_WIDTH = 7;

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
        fill={colors.illustrationDevice}
        stroke={colors.illustrationDeviceLine}
        strokeWidth={2}
      />
      <Rect
        x={81}
        y={14}
        width={50}
        height={100}
        rx={25}
        fill={colors.illustrationDeviceIsland}
        stroke={colors.illustrationDeviceLine}
        strokeWidth={1}
      />
      <Circle
        cx={106}
        cy={90}
        r={15}
        fill={colors.illustrationLens}
        stroke={colors.illustrationDeviceLine}
        strokeWidth={1.5}
      />
      <G rotation={FINGER_ANGLE_DEG} origin="160, 52">
        <Rect x={75} y={24} width={170} height={56} rx={28} fill={colors.illustrationFinger} />
      </G>
      {/* A page-colour halo under each ring keeps it readable over both the finger and the phone body. */}
      <Circle cx={106} cy={42} r={22} fill="none" stroke={colors.bg} strokeWidth={HALO_WIDTH} />
      <Circle cx={106} cy={42} r={22} fill="none" stroke={colors.accent} strokeWidth={3} />
      <Circle cx={146} cy={42} r={13} fill="none" stroke={colors.bg} strokeWidth={HALO_WIDTH} />
      <Circle cx={146} cy={42} r={13} fill="none" stroke={colors.flag} strokeWidth={3} />
      <Line x1={42} y1={48} x2={84} y2={42} stroke={colors.accent} strokeWidth={1.5} />
      <SvgText x={4} y={52} fill={colors.accent} fontSize={LABEL_SIZE} fontWeight="600">
        {lensLabel}
      </SvgText>
      <Line x1={160} y1={42} x2={250} y2={38} stroke={colors.flag} strokeWidth={1.5} />
      <SvgText x={255} y={44} fill={colors.flag} fontSize={LABEL_SIZE} fontWeight="600">
        {flashLabel}
      </SvgText>
    </Svg>
  );
}

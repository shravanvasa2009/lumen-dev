import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import { phoneBackLayout, placementCopy, type Lens } from './phoneBackLayouts';

const WIDTH = 338;
const HEIGHT = 184;
const PHONE = { x: 64, y: 36, width: 210, height: 220, rx: 36 };
const LABEL_Y = 16;
const LEADER_TOP = 22;
const RING_GAP = 7;

// The back of the phone this build runs on, cut off at the bottom, with the fingertip over the lens and flash
// that must be covered.
export function PlacementFigure() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const layout = phoneBackLayout();
  const { cameraIsland: island, lenses, flash, fingerPad } = layout;
  const lensDisc = ({ cx, cy, r }: Lens, key: string) => (
    <G key={key}>
      <Circle cx={cx} cy={cy} r={r} fill={colors.illustrationLens} />
      <Circle cx={cx} cy={cy} r={r * 0.45} fill={colors.illustrationDeviceLine} fillOpacity={0.5} />
    </G>
  );
  const target = (spot: Lens, label: { x: number; anchor: 'start' | 'middle' | 'end' }, text: string) => {
    const ringRadius = spot.r + RING_GAP;
    return (
      <>
        <Line
          x1={spot.cx}
          y1={LEADER_TOP}
          x2={spot.cx}
          y2={spot.cy - ringRadius}
          stroke={colors.accent}
          strokeWidth={1.5}
        />
        <Circle cx={spot.cx} cy={spot.cy} r={ringRadius} fill="none" stroke={colors.accent} strokeWidth={2.5} />
        <SvgText x={label.x} y={LABEL_Y} textAnchor={label.anchor} fontSize={12} fontWeight="600" fill={colors.accent}>
          {text}
        </SvgText>
      </>
    );
  };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={placementCopy(t).figureLabel}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.sheet,
        paddingTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        height: HEIGHT + spacing.lg,
        overflow: 'hidden',
      }}
    >
      <Svg
        testID={`placement-figure-${layout.model}`}
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        accessibilityElementsHidden
      >
        <Rect {...PHONE} fill={colors.illustrationDevice} />
        <Rect {...island} fill={colors.illustrationDeviceIsland} />
        {lenses.map((lens, index) => lensDisc(lens, `lens-${index}`))}
        {layout.extras.map((spot, index) => lensDisc(spot, `extra-${index}`))}
        <Circle
          cx={flash.cx}
          cy={flash.cy}
          r={flash.r}
          fill={colors.illustrationFlash}
          stroke={colors.illustrationDeviceLine}
          strokeWidth={1}
        />
        <Rect
          {...fingerPad}
          rx={fingerPad.height / 2}
          fill={colors.illustrationFinger}
          fillOpacity={0.5}
          stroke={colors.illustrationSkin}
          strokeWidth={1.5}
        />
        {target(lenses[0]!, layout.lensLabel, t('placement.mainLens'))}
        {target(flash, layout.flashLabel, t('placement.flash'))}
      </Svg>
    </View>
  );
}

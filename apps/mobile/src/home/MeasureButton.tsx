import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type MeasureButtonProps = { label: string; modeLabel: string; size: number; onPress: () => void };

const DISC_SHARE = 0.8;
// Sizes from the approved mockup (four-checks-v2 10-home): 256 dp disc in a 320 dp halo, and a 164 dp halo on
// a 360 x 640 phone.
const REGULAR_MIN_SIZE = 250;
const TEXT = {
  regular: { label: 40, labelLine: 44, mode: 16, modeLine: 20 },
  small: { label: 26, labelLine: 30, mode: 14, modeLine: 18 },
};
// The mockup's gradient: highlight focus at 34% / 28% of the disc, solid accentFill to 58% of the way to the
// farthest corner, then the rim colour. Fractions are of the disc width.
const FOCUS = { x: 0.34, y: 0.28 };
const FARTHEST_CORNER = Math.hypot(1 - FOCUS.x, 1 - FOCUS.y);
const SOLID_END = 0.58;
const HIGHLIGHT_END = 0.38;
const HIGHLIGHT_OPACITY = 0.38;
const DARK_RIM_OPACITY = 0.42;
const TEXT_WIDTH_SHARE = 0.8;
// Dark text keeps at least 4.5:1 while the rim colour is under about 45% mixed in (light: accent over
// accentFill; dark: the background over accentFill). That is 0.75 of the disc width from the focus.
const READABLE_REACH = 0.75;

// How far the text box corner sits from the gradient focus, against how far the text stays readable.
export function measureLayout(size: number, modeLines: number) {
  const disc = size * DISC_SHARE;
  const text = size >= REGULAR_MIN_SIZE ? TEXT.regular : TEXT.small;
  const halfWidth = (disc * TEXT_WIDTH_SHARE) / 2;
  const halfHeight = (text.labelLine + text.modeLine * modeLines) / 2;
  return {
    discRadius: disc / 2,
    textWidth: disc * TEXT_WIDTH_SHARE,
    text,
    cornerFromFocus: Math.hypot(halfWidth + (0.5 - FOCUS.x) * disc, halfHeight + (0.5 - FOCUS.y) * disc),
    readableReach: READABLE_REACH * disc,
  };
}

export function MeasureButton({ label, modeLabel, size, onPress }: MeasureButtonProps) {
  const { colors, isDark } = useTheme();
  const center = size / 2;
  const { discRadius, textWidth, text } = measureLayout(size, 1);
  const highlight = isDark ? colors.text : colors.surface;
  const rim = isDark ? colors.bg : colors.accent;
  const rimOpacity = isDark ? DARK_RIM_OPACITY : 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={modeLabel}
      onPress={onPress}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient
            id="measureFill"
            cx={`${FOCUS.x * 100}%`}
            cy={`${FOCUS.y * 100}%`}
            fx={`${FOCUS.x * 100}%`}
            fy={`${FOCUS.y * 100}%`}
            r={`${FARTHEST_CORNER * 100}%`}
          >
            <Stop offset="0" stopColor={highlight} stopOpacity={HIGHLIGHT_OPACITY} />
            <Stop offset={HIGHLIGHT_END} stopColor={highlight} stopOpacity={0} />
            <Stop offset={SOLID_END} stopColor={rim} stopOpacity={0} />
            <Stop offset="1" stopColor={rim} stopOpacity={rimOpacity} />
          </RadialGradient>
        </Defs>
        <Circle cx={center} cy={center} r={center} fill={colors.accentFill} fillOpacity={0.14} />
        <Circle
          cx={center}
          cy={center}
          r={(center + discRadius) / 2}
          fill={colors.accentFill}
          fillOpacity={0.24}
        />
        <Circle cx={center} cy={center} r={discRadius} fill={colors.accentFill} />
        <Circle
          cx={center}
          cy={center}
          r={discRadius}
          fill="url(#measureFill)"
          stroke={colors.accent}
          strokeWidth={3}
        />
      </Svg>
      <View style={{ alignItems: 'center', width: textWidth }}>
        <AppText
          variant="display"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: colors.onAccentFill, fontSize: text.label, lineHeight: text.labelLine }}
        >
          {label}
        </AppText>
        <AppText
          style={{
            color: colors.onAccentFill,
            textAlign: 'center',
            fontSize: text.mode,
            lineHeight: text.modeLine,
            fontWeight: '600',
          }}
        >
          {modeLabel}
        </AppText>
      </View>
    </Pressable>
  );
}

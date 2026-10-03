import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type MeasureButtonProps = { label: string; modeLabel: string; size: number; onPress: () => void };

const DISC_SHARE = 0.8;
// The gradient is fully solid out to this share of the disc radius, then fades toward the edge.
const SOLID_SHARE = 0.85;
const TEXT_WIDTH_SHARE = 0.7;
// The label is one line; the mode line may wrap to two (Spanish is longer).
const TEXT_LINES = 3;

// The text box must sit wholly inside the solid part of the disc, so the label is always read against the
// solid accentFill. The corner of that box is the farthest point of the text from the centre.
export function measureLayout(size: number, lineHeight: number) {
  const disc = size * DISC_SHARE;
  const textWidth = disc * TEXT_WIDTH_SHARE;
  const textHeight = lineHeight * TEXT_LINES;
  return {
    discRadius: disc / 2,
    solidRadius: (disc / 2) * SOLID_SHARE,
    textWidth,
    textCorner: Math.hypot(textWidth / 2, textHeight / 2),
    labelSize: disc * 0.15,
  };
}

const MODE_LINE_HEIGHT = 18;

export function MeasureButton({ label, modeLabel, size, onPress }: MeasureButtonProps) {
  const { colors } = useTheme();
  const center = size / 2;
  const { discRadius, textWidth, labelSize } = measureLayout(size, MODE_LINE_HEIGHT);
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
          <RadialGradient id="measureFill" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.accentFill} stopOpacity={1} />
            <Stop offset={SOLID_SHARE} stopColor={colors.accentFill} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.accentFill} stopOpacity={0.55} />
          </RadialGradient>
        </Defs>
        <Circle cx={center} cy={center} r={center} fill={colors.accentFill} fillOpacity={0.1} />
        <Circle
          cx={center}
          cy={center}
          r={(center + discRadius) / 2}
          fill={colors.accentFill}
          fillOpacity={0.2}
        />
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
          style={{ color: colors.onAccentFill, fontSize: labelSize, lineHeight: labelSize * 1.2 }}
        >
          {label}
        </AppText>
        <AppText
          variant="caption"
          style={{ color: colors.onAccentFill, textAlign: 'center', lineHeight: MODE_LINE_HEIGHT }}
        >
          {modeLabel}
        </AppText>
      </View>
    </Pressable>
  );
}

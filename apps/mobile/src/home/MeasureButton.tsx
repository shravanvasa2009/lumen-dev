import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type MeasureButtonProps = { label: string; modeLabel: string; size: number; onPress: () => void };

// Sizes from the approved mockup (proposal 2026-10-04, M3): a 320 dp button, and 164 dp on a 360 x 640 phone.
const REGULAR_MIN_SIZE = 250;
const TEXT = {
  regular: { label: 40, labelLine: 44, mode: 17, modeLine: 22 },
  small: { label: 26, labelLine: 30, mode: 14, modeLine: 18 },
};
// One radial gradient: a flat core to CORE_END of the radius so the text always sits on one known colour,
// then the same colour fading into the halo. Offsets and opacities are the approved mockup values.
const CORE_END = 0.7;
const FADE = {
  edge: { offset: 0.76, opacity: 0.92 },
  mid: { offset: 0.82, opacity: 0.42 },
  outer: { offset: 0.91, opacity: 0.16 },
  gone: { offset: 1, opacity: 0 },
};
const TEXT_WIDTH_SHARE = 0.64;
// Past this share of the radius the fill is under 0.92 opaque and reads as halo, so the text stays inside it
// to sit on the solid-looking disc.
const READABLE_SHARE = FADE.edge.offset;

// How far the text box corner sits from the centre, against how far the text stays on a near-opaque fill.
export function measureLayout(size: number, modeLines: number) {
  const text = size >= REGULAR_MIN_SIZE ? TEXT.regular : TEXT.small;
  const textWidth = size * TEXT_WIDTH_SHARE;
  const halfHeight = (text.labelLine + text.modeLine * modeLines) / 2;
  return {
    textWidth,
    text,
    cornerFromCenter: Math.hypot(textWidth / 2, halfHeight),
    readableReach: (size / 2) * READABLE_SHARE,
  };
}

export function MeasureButton({ label, modeLabel, size, onPress }: MeasureButtonProps) {
  const { colors } = useTheme();
  const center = size / 2;
  const { textWidth, text } = measureLayout(size, 1);
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
          <RadialGradient id="measureFill" cx="50%" cy="50%" fx="50%" fy="50%" r="50%">
            <Stop offset={0} stopColor={colors.measureCore} stopOpacity={1} />
            <Stop offset={CORE_END} stopColor={colors.measureCore} stopOpacity={1} />
            <Stop offset={FADE.edge.offset} stopColor={colors.measureCore} stopOpacity={FADE.edge.opacity} />
            <Stop offset={FADE.mid.offset} stopColor={colors.measureCore} stopOpacity={FADE.mid.opacity} />
            <Stop
              offset={FADE.outer.offset}
              stopColor={colors.measureCore}
              stopOpacity={FADE.outer.opacity}
            />
            <Stop offset={FADE.gone.offset} stopColor={colors.measureCore} stopOpacity={FADE.gone.opacity} />
          </RadialGradient>
        </Defs>
        <Circle cx={center} cy={center} r={center} fill="url(#measureFill)" />
      </Svg>
      <View style={{ alignItems: 'center', width: textWidth }}>
        <AppText
          variant="display"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: colors.text, fontSize: text.label, lineHeight: text.labelLine }}
        >
          {label}
        </AppText>
        <AppText
          style={{
            color: colors.text,
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

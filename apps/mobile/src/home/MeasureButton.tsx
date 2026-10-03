import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type MeasureButtonProps = { label: string; modeLabel: string; size: number; onPress: () => void };

// The label sits on the solid accentFill middle (onAccentFill on accentFill is a checked pair); only the
// outer edge fades, and no text reaches it.
export function MeasureButton({ label, modeLabel, size, onPress }: MeasureButtonProps) {
  const { colors } = useTheme();
  const center = size / 2;
  const halo = size * 0.07;
  const disc = center - halo * 2;
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
            <Stop offset="0.7" stopColor={colors.accentFill} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.accentFill} stopOpacity={0.55} />
          </RadialGradient>
        </Defs>
        <Circle cx={center} cy={center} r={center} fill={colors.accentFill} fillOpacity={0.1} />
        <Circle cx={center} cy={center} r={center - halo} fill={colors.accentFill} fillOpacity={0.2} />
        <Circle
          cx={center}
          cy={center}
          r={disc}
          fill="url(#measureFill)"
          stroke={colors.accent}
          strokeWidth={3}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <AppText variant="display" style={{ color: colors.onAccentFill, fontSize: size * 0.17 }}>
          {label}
        </AppText>
        <AppText style={{ color: colors.onAccentFill }}>{modeLabel}</AppText>
      </View>
    </Pressable>
  );
}

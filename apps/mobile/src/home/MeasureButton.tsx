import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const SIZE = 280;
const CENTER = SIZE / 2;

type MeasureButtonProps = { label: string; modeLabel: string; onPress: () => void };

export function MeasureButton({ label, modeLabel, onPress }: MeasureButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={modeLabel}
      onPress={onPress}
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="measureFill" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.accentFill} stopOpacity={0.4} />
            <Stop offset="1" stopColor={colors.accentFill} stopOpacity={0.05} />
          </RadialGradient>
        </Defs>
        <Circle cx={CENTER} cy={CENTER} r={CENTER} fill={colors.accentFill} fillOpacity={0.07} />
        <Circle cx={CENTER} cy={CENTER} r={CENTER - 18} fill={colors.accentFill} fillOpacity={0.1} />
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER - 36}
          fill="url(#measureFill)"
          stroke={colors.accentFill}
          strokeOpacity={0.6}
          strokeWidth={2}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <AppText variant="display">{label}</AppText>
        <AppText tone="textDim">{modeLabel}</AppText>
      </View>
    </Pressable>
  );
}

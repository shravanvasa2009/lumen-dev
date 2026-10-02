import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

const CIRCLE_SIZE = 120;
const GLOW_PAD = 14;
const SIZE = CIRCLE_SIZE + GLOW_PAD * 2;

type FingertipProps = { pressed: boolean };

// Pressed: blood is pushed out, so the tip is pale. Relaxed: the lit tip is saturated red with a soft glow.
function Fingertip({ pressed }: FingertipProps) {
  const { colors } = useTheme();
  const id = pressed ? 'fingertip-pressed' : 'fingertip-relaxed';
  return (
    <Svg
      width={SIZE}
      height={SIZE}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.pulse} stopOpacity={pressed ? 0.22 : 0.85} />
          <Stop offset="1" stopColor={colors.pulse} stopOpacity={pressed ? 0.45 : 1} />
        </RadialGradient>
      </Defs>
      {pressed ? null : (
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={CIRCLE_SIZE / 2 + GLOW_PAD}
          fill={colors.pulse}
          opacity={0.14}
        />
      )}
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={CIRCLE_SIZE / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

// Spec §8.3: pale pressed fingertip beside the red relaxed one.
export function FingertipPair() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const captions = [
    { pressed: true, label: t('fix.tooHard'), icon: 'close' as const, color: colors.flag },
    { pressed: false, label: t('fix.justRight'), icon: 'check' as const, color: colors.accent },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      {captions.map(({ pressed, label, icon, color }) => (
        <View key={label} style={{ alignItems: 'center', gap: spacing.xs }}>
          <Fingertip pressed={pressed} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon name={icon} size={18} color={color} />
            <AppText tone="textDim">{label}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

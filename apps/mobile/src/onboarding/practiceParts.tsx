import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import { timingConfig, useReduceMotion } from '@/theme/motion';

const PREVIEW_SIZE = 190;
const METER_HEIGHT = 28;
const RING_SIZE = 44;
const RING_STROKE = 5;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// The lit fingertip as the camera sees it. Dim while no finger is detected.
export function FingerPreview({ detected, size = PREVIEW_SIZE }: { detected: boolean; size?: number }) {
  const { colors } = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id="finger-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.pulse} stopOpacity={0.75} />
          <Stop offset="1" stopColor={colors.pulse} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2}
        fill="url(#finger-glow)"
        opacity={detected ? 1 : 0.3}
      />
    </Svg>
  );
}

// Keeps the marker inside the bar at both ends.
const MARKER_INSET_PCT = 4;
const MARKER_SPAN_PCT = 100 - 2 * MARKER_INSET_PCT;

// Weak to Strong coupling bar. The marker shows `level` (0 to 1) and is left out while there is none.
export function SignalMeter({ level = null }: { level?: number | null }) {
  const { colors } = useTheme();
  const marked = level === null ? null : Math.min(1, Math.max(0, level));
  return (
    <Svg
      width="100%"
      height={METER_HEIGHT}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="signal-scale" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.badgePublicFg} />
          <Stop offset="1" stopColor={colors.accentFill} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height={METER_HEIGHT} rx={METER_HEIGHT / 2} fill="url(#signal-scale)" />
      {marked === null ? null : (
        <Circle
          testID="signal-marker"
          cx={`${MARKER_INSET_PCT + marked * MARKER_SPAN_PCT}%`}
          cy={METER_HEIGHT / 2}
          r={METER_HEIGHT / 2 - 4}
          fill={colors.text}
          stroke={colors.bg}
          strokeWidth={2}
        />
      )}
    </Svg>
  );
}

// The label under the marker, by thirds of the bar; none while there is no level.
export function labelAt(level: number | null): 'weak' | 'ok' | 'strong' | null {
  if (level === null) return null;
  if (level < 1 / 3) return 'weak';
  return level < 2 / 3 ? 'ok' : 'strong';
}

// The Weak, OK, Strong labels under the meter; the one the marker is over is emphasised.
export function SignalScale({ level = null }: { level?: number | null }) {
  const { t } = useTranslation();
  const current = labelAt(level);
  const label = (name: 'weak' | 'ok' | 'strong', text: string) => (
    <AppText
      variant="caption"
      tone={current === name ? 'accent' : 'textDim'}
      style={current === name ? { fontWeight: '600' } : undefined}
    >
      {text}
    </AppText>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {label('weak', t('signal.weak'))}
      {label('ok', t('signal.ok'))}
      {label('strong', t('signal.strong'))}
    </View>
  );
}

type RingProps = {
  fraction: number;
  size?: number;
  strokeWidth?: number;
  // Amber while the count is held, as on the capture screen.
  paused?: boolean;
};

export function ProgressRing({
  fraction,
  size = RING_SIZE,
  strokeWidth = RING_STROKE,
  paused = false,
}: RingProps) {
  const { colors } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const reduceMotion = useReduceMotion();
  const target = Math.min(1, Math.max(0, fraction));
  // The arc eases to each new value on the UI thread instead of jumping once a second.
  // Built on the JS thread: timingConfig is a plain function, and calling one inside the worklet below
  // crashes the app on a phone ("Tried to synchronously call a Remote Function").
  const timing = timingConfig(reduceMotion);
  const arc = useDerivedValue(() => withTiming(target, timing));
  const arcProps = useAnimatedProps(() => ({
    strokeDasharray: `${circumference * arc.value} ${circumference}`,
  }));
  return (
    <Svg
      width={size}
      height={size}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={colors.surface3}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <AnimatedCircle
        animatedProps={arcProps}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={paused ? colors.flag : colors.accent}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        rotation={-90}
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  );
}

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
export function FingerPreview({ detected }: { detected: boolean }) {
  const { colors } = useTheme();
  return (
    <Svg
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
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
        cx={PREVIEW_SIZE / 2}
        cy={PREVIEW_SIZE / 2}
        r={PREVIEW_SIZE / 2}
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

// The Weak, OK, Strong labels under the meter.
export function SignalScale() {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText variant="caption" tone="textDim">
        {t('signal.weak')}
      </AppText>
      <AppText variant="caption" tone="textDim">
        {t('signal.ok')}
      </AppText>
      <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
        {t('signal.strong')}
      </AppText>
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
  const arc = useDerivedValue(() => withTiming(target, timingConfig(reduceMotion)));
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

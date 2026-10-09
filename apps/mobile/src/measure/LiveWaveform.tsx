import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { useReduceMotion } from '@/theme/motion';

import { quantileRange } from './waveformScale';
import { easeRange, glideDurationMs, smoothPath, type Range } from './waveformPath';
import { WAVEFORM_WINDOW_NS } from './waveformWindow';

const DEFAULT_HEIGHT = 96;
const PADDING = 8;
// The filtered trace is scaled to its 3rd to 97th percentile and clamped, so one spike does not flatten the beats.
const ROBUST_LOW = 0.03;
const ROBUST_HIGH = 0.97;
const RAW_HEIGHT_SHARE = 0.5;
const MIN_RAW_HEIGHT = 24;
const WINDOW_MS = WAVEFORM_WINDOW_NS / 1e6;
// Samples reach the screen in batches about every 100 ms; between batches the trace glides on at the scroll
// speed (the card's width per window). A longer gap is a stall, and the trace waits for the next batch instead.
const MAX_GLIDE_MS = 150;
// The vertical scale follows the robust range with this time constant, so it settles in about a second.
const RANGE_SETTLE_MS = 400;
const DOT_RADIUS = 3;
const HALO_RADIUS = 7;
const HALO_OPACITY = 0.22;
const FADE_START_OPACITY = 0.15;

type Scale = 'minMax' | 'robust';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type TraceProps = {
  values: readonly number[];
  width: number;
  height: number;
  scale: Scale;
  // The filtered pulse is already flipped (a beat is a peak); raw red falls as blood fills the fingertip, so it is
  // flipped here to draw each beat as a peak too.
  upIsHigh: boolean;
  stroke: string;
  strokeWidth: number;
  testID: string;
};

// Draws the newest `values` right-aligned as a smooth curve ending in a soft dot. A path update lands every ~100 ms,
// so each one starts shifted right by the distance the trace scrolled meanwhile and slides back to rest on the UI
// thread; the eye sees a steady sweep and the JS thread does no per-frame work.
function Trace({ values, width, height, scale, upIsHigh, stroke, strokeWidth, testID }: TraceProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const pathD = useSharedValue('');
  const dotY = useSharedValue(height / 2);
  const shift = useSharedValue(0);
  const easedRange = useRef<Range | null>(null);
  const updatedAt = useRef<number | null>(null);
  const capacity = useRef(0);
  const previousCount = useRef<number | null>(null);
  const hasTrace = values.length >= 2;
  const drawable = hasTrace && width > 0;
  const dotX = width - HALO_RADIUS - (MAX_GLIDE_MS / WINDOW_MS) * width;

  useEffect(() => {
    if (!drawable) {
      easedRange.current = null;
      updatedAt.current = null;
      capacity.current = 0;
      previousCount.current = null;
      return;
    }
    const now = performance.now();
    const elapsed = updatedAt.current === null ? 0 : now - updatedAt.current;
    updatedAt.current = now;
    const target =
      scale === 'robust' ? quantileRange(values, ROBUST_LOW, ROBUST_HIGH) : quantileRange(values, 0, 1);
    easedRange.current = easeRange(easedRange.current, target, elapsed, RANGE_SETTLE_MS);
    const low = easedRange.current?.low ?? 0;
    const span = (easedRange.current?.high ?? 0) - low;
    capacity.current = Math.max(capacity.current, values.length);
    // The dot and its halo stay inside the card even at the start of a glide, when the trace sits a full glide to the right.
    const right = dotX;
    const step = right / (capacity.current - 1);
    const points = values.map((value, index) => {
      const unit = span > 0 ? Math.min(1, Math.max(0, (value - low) / span)) : 0.5;
      const drawn = upIsHigh ? 1 - unit : unit;
      return {
        x: right - (values.length - 1 - index) * step,
        y: PADDING + drawn * (height - 2 * PADDING),
      };
    });
    pathD.value = smoothPath(points, height);
    dotY.value = points[points.length - 1]!.y;
    const glideMs = glideDurationMs(
      previousCount.current,
      values.length,
      elapsed,
      MAX_GLIDE_MS,
      reduceMotion,
    );
    previousCount.current = values.length;
    if (glideMs === 0) {
      shift.value = 0;
      return;
    }
    shift.value = (glideMs / WINDOW_MS) * width;
    shift.value = withTiming(0, { duration: glideMs, easing: Easing.linear });
  }, [values, width, height, scale, upIsHigh, reduceMotion, drawable, dotX, pathD, dotY, shift]);

  const pathProps = useAnimatedProps(() => ({ d: pathD.value }));
  const dotProps = useAnimatedProps(() => ({ cy: dotY.value }));
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  const fadeId = `${testID}-fade`;
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Animated.View style={slideStyle}>
        <Svg
          width="100%"
          height={height}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {hasTrace ? (
            <>
              <Defs>
                <LinearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={width} y2={0}>
                  <Stop offset="0" stopColor={stroke} stopOpacity={FADE_START_OPACITY} />
                  <Stop offset="1" stopColor={stroke} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <AnimatedPath
                testID={testID}
                animatedProps={pathProps}
                fill="none"
                stroke={`url(#${fadeId})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <AnimatedCircle
                animatedProps={dotProps}
                cx={dotX}
                r={HALO_RADIUS}
                fill={stroke}
                fillOpacity={HALO_OPACITY}
              />
              <AnimatedCircle animatedProps={dotProps} cx={dotX} r={DOT_RADIUS} fill={stroke} />
            </>
          ) : (
            <Line
              x1="0%"
              y1={height / 2}
              x2="100%"
              y2={height / 2}
              stroke={colors.line2}
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

type LiveWaveformProps = {
  // The session's filtered pulse of the last 6 s (peaks up) and the camera's raw red of the same window.
  pulse: readonly number[];
  red: readonly number[];
  height?: number;
  // The dicrotic-wave fun fact under the raw trace; compact screens leave it out to keep Stop in reach.
  withFact?: boolean;
};

// Two traces at once: the filtered pulse a person expects a heart trace to look like, larger, and the raw camera
// signal as it arrives, smaller and muted. Display only; beats and rejections come from the LiveSession.
export function LiveWaveform({ pulse, red, height = DEFAULT_HEIGHT, withFact = true }: LiveWaveformProps) {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const rawHeight = Math.max(MIN_RAW_HEIGHT, Math.round(height * RAW_HEIGHT_SHARE));
  return (
    <View
      testID="live-waveform-card"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ gap: spacing.xs }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText tone="textDim">{t('capture.wavePulse')}</AppText>
        <AppText tone="textDim">{t('capture.last6s')}</AppText>
      </View>
      <Trace
        values={pulse}
        width={width}
        height={height}
        scale="robust"
        upIsHigh
        stroke={colors.pulse}
        strokeWidth={2}
        testID="live-waveform"
      />
      <AppText variant="caption" tone="textDim">
        {t('capture.waveRaw')}
      </AppText>
      <Trace
        values={red}
        width={width}
        height={rawHeight}
        scale="minMax"
        upIsHigh={false}
        stroke={colors.textDim}
        strokeWidth={1.5}
        testID="live-waveform-raw"
      />
      {withFact ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
          <Icon name="hint" size={16} color={colors.textDim} />
          <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
            {t('capture.waveFact')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

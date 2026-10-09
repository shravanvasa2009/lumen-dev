import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { useReduceMotion } from '@/theme/motion';

import { quantileRange } from './waveformScale';
import { easeRange, type Range } from './waveformPath';
import {
  advancePlayhead,
  mergeSeries,
  PLAYBACK_DELAY_S,
  playheadTargetS,
  smoothClockOffset,
  tracePath,
  type Series,
  type TraceGeometry,
} from './waveformPlayback';
import { WAVEFORM_WINDOW_NS } from './waveformWindow';

const DEFAULT_HEIGHT = 96;
const PADDING = 8;
// The filtered trace is scaled to its 3rd to 97th percentile and clamped, so one spike does not flatten the beats.
const ROBUST_LOW = 0.03;
const ROBUST_HIGH = 0.97;
const RAW_HEIGHT_SHARE = 0.5;
const MIN_RAW_HEIGHT = 24;
const WINDOW_S = WAVEFORM_WINDOW_NS / 1e9;
// The trace is drawn up to PLAYBACK_DELAY_S behind the newest sample, so the history kept must cover the window
// plus that delay (and a little more for the sample just outside the left edge).
const KEEP_S = WINDOW_S + PLAYBACK_DELAY_S + 0.5;
// The vertical scale follows the robust range with this time constant, so it settles in about a second.
const RANGE_SETTLE_MS = 400;
const DOT_RADIUS = 3;
const HALO_RADIUS = 7;
const HALO_OPACITY = 0.22;
const FADE_START_OPACITY = 0.15;

type Scale = 'minMax' | 'robust';

// What the JS thread hands the UI thread per batch; `version` tells the frame callback a new batch has landed.
type Playback = Series & { version: number; low: number; high: number };

const NO_PLAYBACK: Playback = { t: [], v: [], version: 0, low: 0, high: 1 };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type TraceProps = {
  values: readonly number[];
  timesS: readonly number[];
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

// Draws the trace like a hospital monitor: a fixed delay behind the newest sample, scrolling at one constant speed.
// Each batch only hands the UI thread the recent (time, value) samples; every frame the UI thread moves the right
// edge by the elapsed time and rebuilds the path from the samples' own timestamps, so a late or doubled batch
// changes nothing on screen and the JS thread does no per-frame work.
// The capture screen sets StillMotion (ADR 0075), but this waveform is the one thing the owner wants animated
// there (owner, 2026-10-09), so it deliberately ignores that context. Reduce Motion still turns scrolling off:
// the trace is drawn once per batch, right-aligned on the newest sample.
function Trace({ values, timesS, width, height, scale, upIsHigh, stroke, strokeWidth, testID }: TraceProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const pathD = useSharedValue('');
  const dotY = useSharedValue(height / 2);
  const playback = useSharedValue<Playback>(NO_PLAYBACK);
  const seenVersion = useSharedValue(0);
  const clockOffsetMs = useSharedValue<number | null>(null);
  const playhead = useSharedValue<number | null>(null);
  const easedRange = useSharedValue<Range | null>(null);
  const geometry = useMemo<TraceGeometry>(
    () => ({ width, height, dotX: width - HALO_RADIUS, padding: PADDING, windowS: WINDOW_S, upIsHigh }),
    [width, height, upIsHigh],
  );
  const geometryOnUi = useSharedValue<TraceGeometry>(geometry);
  const stored = useRef<Series>({ t: [], v: [] });
  const batches = useRef(0);
  const hasTrace = values.length >= 2 && timesS.length === values.length;
  const drawable = hasTrace && width > 0;

  const drawFrame = useCallback(
    (frame: FrameInfo) => {
      'worklet';
      const batch = playback.value;
      const newest = batch.t[batch.t.length - 1];
      if (newest === undefined) return;
      if (batch.version !== seenVersion.value) {
        seenVersion.value = batch.version;
        clockOffsetMs.value = smoothClockOffset(clockOffsetMs.value, frame.timestamp - newest * 1000);
      }
      const offset = clockOffsetMs.value;
      if (offset === null) return;
      const elapsed = frame.timeSincePreviousFrame ?? 0;
      const edge = advancePlayhead(playhead.value, elapsed, playheadTargetS(frame.timestamp, offset), newest);
      playhead.value = edge;
      const range = easeRange(
        easedRange.value,
        { low: batch.low, high: batch.high },
        elapsed,
        RANGE_SETTLE_MS,
      );
      easedRange.value = range;
      if (!range) return;
      const drawn = tracePath(batch, edge, range, geometryOnUi.value);
      if (!drawn) return;
      pathD.value = drawn.d;
      dotY.value = drawn.dotY;
    },
    [playback, seenVersion, clockOffsetMs, playhead, easedRange, geometryOnUi, pathD, dotY],
  );
  const frames = useFrameCallback(drawFrame, false);

  useEffect(() => {
    geometryOnUi.value = geometry;
  }, [geometry, geometryOnUi]);

  useEffect(() => {
    frames.setActive(drawable && !reduceMotion);
  }, [frames, drawable, reduceMotion]);

  useEffect(() => {
    if (!drawable) {
      stored.current = { t: [], v: [] };
      playback.value = NO_PLAYBACK;
      playhead.value = null;
      clockOffsetMs.value = null;
      easedRange.value = null;
      pathD.value = '';
      return;
    }
    stored.current = mergeSeries(stored.current, { t: [...timesS], v: [...values] }, KEEP_S);
    const { t, v } = stored.current;
    const newest = t[t.length - 1];
    if (newest === undefined) return;
    const visible = v.filter((_, index) => newest - t[index]! <= WINDOW_S);
    const target =
      scale === 'robust' ? quantileRange(visible, ROBUST_LOW, ROBUST_HIGH) : quantileRange(visible, 0, 1);
    if (!target) return;
    batches.current += 1;
    playback.value = { t, v, version: batches.current, low: target.low, high: target.high };
    if (!reduceMotion) return;
    easedRange.value = target;
    playhead.value = newest;
    const drawn = tracePath(stored.current, newest, target, geometry);
    if (!drawn) return;
    pathD.value = drawn.d;
    dotY.value = drawn.dotY;
  }, [
    values,
    timesS,
    scale,
    drawable,
    reduceMotion,
    geometry,
    playback,
    playhead,
    clockOffsetMs,
    easedRange,
    pathD,
    dotY,
  ]);

  const pathProps = useAnimatedProps(() => ({ d: pathD.value }));
  const dotProps = useAnimatedProps(() => ({ cy: dotY.value }));
  const fadeId = `${testID}-fade`;
  return (
    <View style={{ height, overflow: 'hidden' }}>
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
              cx={geometry.dotX}
              r={HALO_RADIUS}
              fill={stroke}
              fillOpacity={HALO_OPACITY}
            />
            <AnimatedCircle animatedProps={dotProps} cx={geometry.dotX} r={DOT_RADIUS} fill={stroke} />
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
    </View>
  );
}
type LiveWaveformProps = {
  // The session's filtered pulse of the last 6 s (peaks up) and the camera's raw red of the same window.
  pulse: readonly number[];
  red: readonly number[];
  // Seconds on the capture clock of each value above, in the same order.
  pulseTimesS: readonly number[];
  redTimesS: readonly number[];
  height?: number;
  // The dicrotic-wave fun fact under the raw trace; compact screens leave it out to keep Stop in reach.
  withFact?: boolean;
};

// Two traces at once: the filtered pulse a person expects a heart trace to look like, larger, and the raw camera
// signal as it arrives, smaller and muted. Display only; beats and rejections come from the LiveSession.
export function LiveWaveform({
  pulse,
  red,
  pulseTimesS,
  redTimesS,
  height = DEFAULT_HEIGHT,
  withFact = true,
}: LiveWaveformProps) {
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
        timesS={pulseTimesS}
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
        timesS={redTimesS}
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

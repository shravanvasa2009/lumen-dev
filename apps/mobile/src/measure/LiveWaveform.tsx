import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import { quantileRange } from './waveformScale';

const DEFAULT_HEIGHT = 96;
const PADDING = 8;
// The filtered trace is scaled to its 3rd to 97th percentile and clamped, so one spike does not flatten the beats.
const ROBUST_LOW = 0.03;
const ROBUST_HIGH = 0.97;
const RAW_HEIGHT_SHARE = 0.5;
const MIN_RAW_HEIGHT = 24;

type Scale = 'minMax' | 'robust';

// `upIsHigh`: the filtered pulse is already flipped (a beat is a peak); raw red falls as blood fills the
// fingertip, so it is flipped here to draw each beat as a peak too.
function waveformPoints(
  values: readonly number[],
  width: number,
  height: number,
  scale: Scale,
  upIsHigh: boolean,
): string {
  const range =
    scale === 'robust'
      ? quantileRange(values, ROBUST_LOW, ROBUST_HIGH)
      : quantileRange(values, 0, 1);
  const low = range?.low ?? 0;
  const span = (range?.high ?? 0) - low;
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const unit = span > 0 ? Math.min(1, Math.max(0, (value - low) / span)) : 0.5;
      const drawn = upIsHigh ? 1 - unit : unit;
      return `${x.toFixed(1)},${(PADDING + drawn * (height - 2 * PADDING)).toFixed(1)}`;
    })
    .join(' ');
}

type TraceProps = {
  values: readonly number[];
  width: number;
  height: number;
  scale: Scale;
  upIsHigh: boolean;
  stroke: string;
  strokeWidth: number;
  testID: string;
};

function Trace({ values, width, height, scale, upIsHigh, stroke, strokeWidth, testID }: TraceProps) {
  const { colors } = useTheme();
  const points = useMemo(
    () => waveformPoints(values, width, height, scale, upIsHigh),
    [values, width, height, scale, upIsHigh],
  );
  return (
    <Svg
      width="100%"
      height={height}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {values.length < 2 ? (
        <Line x1="0%" y1={height / 2} x2="100%" y2={height / 2} stroke={colors.line2} strokeWidth={2} />
      ) : (
        <Polyline
          testID={testID}
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
    </Svg>
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
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: spacing.xs }}>
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

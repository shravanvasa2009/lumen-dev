import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { useTheme } from '@/theme';

const DEFAULT_HEIGHT = 96;
const PADDING = 8;

function waveformPoints(red: readonly number[], width: number, height: number): string {
  let low = Infinity;
  let high = -Infinity;
  for (const value of red) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const span = high - low;
  return red
    .map((value, index) => {
      const x = (index / Math.max(1, red.length - 1)) * width;
      const unit = span > 0 ? (value - low) / span : 0.5;
      return `${x.toFixed(1)},${(PADDING + unit * (height - 2 * PADDING)).toFixed(1)}`;
    })
    .join(' ');
}

// The pulse as the camera reports it, scaled to the card's own range so it is visible at any brightness.
// Display only: red falls as blood fills the fingertip, so it is flipped to draw each beat as a peak. The
// real filtering and beat marks come from the LiveSession once it feeds the screen.
export function LiveWaveform({ red, height = DEFAULT_HEIGHT }: { red: readonly number[]; height?: number }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const points = useMemo(() => waveformPoints(red, width, height), [red, width, height]);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Svg
        width="100%"
        height={height}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {red.length < 2 ? (
          <Line x1="0%" y1={height / 2} x2="100%" y2={height / 2} stroke={colors.line2} strokeWidth={2} />
        ) : (
          <Polyline
            testID="live-waveform"
            points={points}
            fill="none"
            stroke={colors.pulse}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </View>
  );
}

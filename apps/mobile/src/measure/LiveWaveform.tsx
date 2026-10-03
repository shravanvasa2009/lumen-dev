import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { useTheme } from '@/theme';

const HEIGHT = 96;
const PADDING = 8;

function waveformPoints(red: readonly number[], width: number): string {
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
      return `${x.toFixed(1)},${(PADDING + unit * (HEIGHT - 2 * PADDING)).toFixed(1)}`;
    })
    .join(' ');
}

// The pulse as the camera reports it, scaled to the card's own range so it is visible at any brightness.
// Display only: red falls as blood fills the fingertip, so it is flipped to draw each beat as a peak. The
// real filtering and beat marks come from the LiveSession once it feeds the screen.
export function LiveWaveform({ red }: { red: readonly number[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const points = useMemo(() => waveformPoints(red, width), [red, width]);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Svg
        width="100%"
        height={HEIGHT}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {red.length < 2 ? (
          <Line x1="0%" y1={HEIGHT / 2} x2="100%" y2={HEIGHT / 2} stroke={colors.line2} strokeWidth={2} />
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

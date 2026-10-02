import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

const size = 160;
const margin = 12;
type PoincarePlotProps = {
  intervalsMs: readonly number[];
  // Shared by both plots, so the spread of one reading is comparable with the typical regular cluster.
  axis: { lowMs: number; highMs: number };
  color: ColorValue;
  label: string;
};

// Each point pairs one beat-to-beat interval with the next one (RR[n] against RR[n+1]).
export function PoincarePlot({ intervalsMs, axis, color, label }: PoincarePlotProps) {
  const { lowMs, highMs } = axis;
  const { colors, radius } = useTheme();
  const scale = (ms: number) => {
    return margin + ((ms - lowMs) / (highMs - lowMs)) * (size - 2 * margin);
  };
  const flip = (coordinate: number) => size - coordinate;
  return (
    <Svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ aspectRatio: 1 }} accessibilityLabel={label}>
      <Rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={radius.card / 2} fill={colors.plotPanel} />
      <Line
        x1={scale(lowMs)}
        y1={flip(scale(lowMs))}
        x2={scale(highMs)}
        y2={flip(scale(highMs))}
        stroke={colors.onPlot}
        strokeOpacity={0.4}
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {intervalsMs.slice(0, -1).map((ms, index) => (
        <Circle
          key={index}
          cx={scale(ms)}
          cy={flip(scale(intervalsMs[index + 1] ?? ms))}
          r={3}
          fill={color}
        />
      ))}
    </Svg>
  );
}

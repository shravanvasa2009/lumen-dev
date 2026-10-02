import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { intervalAxis } from '@/results/axis';

import { paper } from './paper';

const width = 320;
const height = 56;
const inset = 6;

// Beat-to-beat intervals on the same scale as the Show me why chart (400 to 1200 ms unless a reading goes
// outside it), so a steady reading stays flat and an uneven one does not. It is not a raw pulse waveform,
// which the app does not keep.
export function IntervalStrip({
  intervalsMs,
  color,
  label,
}: {
  intervalsMs: readonly number[];
  color: ColorValue;
  label: string;
}) {
  const { lowMs, highMs } = intervalAxis(intervalsMs);
  const xFor = (index: number) => inset + (index / Math.max(1, intervalsMs.length - 1)) * (width - 2 * inset);
  const yFor = (ms: number) => inset + ((highMs - ms) / (highMs - lowMs)) * (height - 2 * inset);
  const points = intervalsMs.map((ms, index) => `${xFor(index)},${yFor(ms)}`).join(' ');
  return (
    <Svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ aspectRatio: width / height }}
      accessibilityLabel={label}
    >
      <Line
        x1={inset}
        x2={width - inset}
        y1={height / 2}
        y2={height / 2}
        stroke={paper.line}
        strokeWidth={1}
      />
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
      {intervalsMs.map((ms, index) => (
        <Circle key={index} cx={xFor(index)} cy={yFor(ms)} r={1.75} fill={color} />
      ))}
    </Svg>
  );
}

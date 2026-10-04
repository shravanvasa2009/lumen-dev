import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme';

const WIDTH = 100;
const HEIGHT = 32;
const PADDING = 2;

// Scaled to its own min and max: it shows the shape of the trend, not absolute size.
export function Sparkline({ points, height = HEIGHT }: { points: readonly number[]; height?: number }) {
  const { colors } = useTheme();
  if (points.length < 2) return null;
  const low = Math.min(...points);
  const span = Math.max(...points) - low || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * WIDTH;
      const y = HEIGHT - PADDING - ((point - low) / span) * (HEIGHT - 2 * PADDING);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={path}
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}

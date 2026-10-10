import type { ColorValue } from 'react-native';
import { G, Line } from 'react-native-svg';

const TICK_WIDTH = 1.5;
const MAJOR_WIDTH = 2.5;
const MAJOR_EXTRA = 4;

export type TickMarksProps = {
  center: number;
  // Where the outer end of every tick sits.
  outerRadius: number;
  length: number;
  count: number;
  // How many ticks, counted clockwise from the top, are drawn in litColor.
  lit?: number;
  litColor?: ColorValue;
  // Every Nth tick from the top is longer and drawn in majorColor.
  majorEvery: number;
  color: ColorValue;
  majorColor: ColorValue;
};

type TickGeometryInput = Pick<TickMarksProps, 'center' | 'outerRadius' | 'length' | 'count'> & {
  index: number;
  major: boolean;
};

export function tickGeometry({ index, count, center, outerRadius, length, major }: TickGeometryInput) {
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
  const innerRadius = outerRadius - length - (major ? MAJOR_EXTRA : 0);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x1: center + outerRadius * cos,
    y1: center + outerRadius * sin,
    x2: center + innerRadius * cos,
    y2: center + innerRadius * sin,
    width: major ? MAJOR_WIDTH : TICK_WIDTH,
    cos,
    sin,
  };
}

// Timer ticks of the redesign: one per second of a reading, or the same marks as dressing on the Measure ball.
export function TickMarks({
  center,
  outerRadius,
  length,
  count,
  lit = 0,
  litColor,
  majorEvery,
  color,
  majorColor,
}: TickMarksProps) {
  return (
    <G>
      {Array.from({ length: count }, (_, index) => {
        const major = index % majorEvery === 0;
        const { x1, y1, x2, y2, width } = tickGeometry({ index, count, center, outerRadius, length, major });
        const stroke = index < lit && litColor ? litColor : major ? majorColor : color;
        return (
          <Line
            key={index}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
          />
        );
      })}
    </G>
  );
}

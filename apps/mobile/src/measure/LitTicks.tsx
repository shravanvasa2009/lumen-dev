import { memo, useEffect, useRef } from 'react';
import type { ColorValue } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { G, Line } from 'react-native-svg';

import { easeOut, reduceMotionMode, useReduceMotion } from '@/theme/motion';

import { tickGeometry, TickMarks, type TickMarksProps } from './TickMarks';

const AnimatedLine = Animated.createAnimatedComponent(Line);

// A newly lit tick swells to this many times its width and reaches outward, with a soft halo, then settles.
const POP_WIDTH_GAIN = 1.2;
const POP_REACH = 3;
const HALO_WIDTH_GAIN = 3;
const HALO_OPACITY = 0.45;
const POP_MS = 520;

type LitTickProps = Pick<TickMarksProps, 'center' | 'outerRadius' | 'length' | 'count'> & {
  index: number;
  major: boolean;
  color: ColorValue;
  // True when the tick lit while the dial was showing, so it pops instead of appearing already lit.
  pops: boolean;
  reduceMotion: boolean;
};

const LitTick = memo(function LitTick({
  index,
  count,
  center,
  outerRadius,
  length,
  major,
  color,
  pops,
  reduceMotion,
}: LitTickProps) {
  const popping = pops && !reduceMotion;
  const pop = useSharedValue(popping ? 1 : 0);
  useEffect(() => {
    if (popping) {
      pop.value = withTiming(0, {
        duration: POP_MS,
        easing: easeOut,
        reduceMotion: reduceMotionMode(reduceMotion),
      });
    }
  }, [pop, popping, reduceMotion]);
  const { x1, y1, x2, y2, width, cos, sin } = tickGeometry({
    index,
    count,
    center,
    outerRadius,
    length,
    major,
  });
  const tickProps = useAnimatedProps(() => ({
    strokeWidth: width * (1 + POP_WIDTH_GAIN * pop.value),
    x1: x1 + cos * POP_REACH * pop.value,
    y1: y1 + sin * POP_REACH * pop.value,
  }));
  const haloProps = useAnimatedProps(() => ({
    opacity: HALO_OPACITY * pop.value,
    x1: x1 + cos * POP_REACH * pop.value,
    y1: y1 + sin * POP_REACH * pop.value,
  }));
  return (
    <G>
      <AnimatedLine
        animatedProps={haloProps}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width * HALO_WIDTH_GAIN}
        strokeLinecap="round"
        opacity={0}
      />
      <AnimatedLine
        animatedProps={tickProps}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    </G>
  );
});

type LitTicksProps = Omit<TickMarksProps, 'lit' | 'litColor'> & {
  lit: number;
  litColor: ColorValue;
};

const StaticTicks = memo(TickMarks);

// Timer ticks that light up as the count rises. The unlit ring is drawn once; each tick that lights adds one small
// overlay whose pop runs on the UI thread, so a rising count never re-renders the rest.
export function LitTicks({ lit, litColor, ...ring }: LitTicksProps) {
  const reduceMotion = useReduceMotion();
  const litNow = Math.min(ring.count, Math.max(0, Math.floor(lit)));
  const litBefore = useRef(litNow);
  const firstNew = litBefore.current;
  useEffect(() => {
    litBefore.current = litNow;
  });
  return (
    <G>
      <StaticTicks {...ring} />
      {Array.from({ length: litNow }, (_, index) => (
        <LitTick
          key={index}
          index={index}
          count={ring.count}
          center={ring.center}
          outerRadius={ring.outerRadius}
          length={ring.length}
          major={index % ring.majorEvery === 0}
          color={litColor}
          pops={index >= firstNew}
          reduceMotion={reduceMotion}
        />
      ))}
    </G>
  );
}

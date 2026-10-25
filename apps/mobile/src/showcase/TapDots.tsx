import { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

// Scripted presses have no finger, so the film would show buttons reacting by themselves; a touch mark where a
// finger would have landed reads as a person using the app. Both films are light mode, so the mark is a grey
// disc with a white rim and a dark outline, which shows on white cards and on the teal buttons alike.
type Tap = { kind: 'tap'; id: number; x: number; y: number };
type Swipe = { kind: 'swipe'; id: number; x: number; fromY: number; toY: number; dragMs: number };
type Mark = Tap | Swipe;

const DOT_SIZE = 54;
const TAP_SHOWN_MS = 650;
const RIPPLE_MS = 450;
// A finger lands up to this share of a control's size away from its centre, at most MAX_OFFSET points.
const OFFSET_SHARE = 0.18;
const MAX_OFFSET = 14;
// Where a scrolling thumb rests: right of centre, in the lower part of the screen.
const SWIPE_X_SHARE = 0.62;
const SWIPE_START_SHARE = 0.74;
const SWIPE_LIFT_MS = 180;

let nextId = 1;
const listeners = new Set<(mark: Mark) => void>();

// The same sequence on both phones (a fixed seed, one draw per mark), so the two films stay alike.
let offsetState = 20261025;
function jitter(): number {
  offsetState = (offsetState * 1103515245 + 12345) % 2147483648;
  return offsetState / 2147483648 - 0.5;
}

function emit(mark: Mark) {
  for (const listener of listeners) listener(mark);
}

/** Shows a touch mark near the centre of a control's window frame. */
export function showTap(frame: { x: number; y: number; width: number; height: number } | null): void {
  if (frame === null) return;
  const dx = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, jitter() * 2 * OFFSET_SHARE * frame.width));
  const dy = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, jitter() * 2 * OFFSET_SHARE * frame.height));
  emit({ kind: 'tap', id: nextId++, x: frame.x + frame.width / 2 + dx, y: frame.y + frame.height / 2 + dy });
}

/** Shows a thumb dragging `distance` points (up when positive) over `dragMs`, then lifting off. */
export function showSwipe(distance: number, dragMs: number): void {
  const { width, height } = Dimensions.get('window');
  const fromY = height * (distance > 0 ? SWIPE_START_SHARE : 1 - SWIPE_START_SHARE) + jitter() * 30;
  emit({
    kind: 'swipe',
    id: nextId++,
    x: width * SWIPE_X_SHARE + jitter() * 40,
    fromY,
    toY: Math.min(height * 0.85, Math.max(height * 0.15, fromY - distance)),
    dragMs,
  });
}

function TapMark({ mark }: { mark: Tap }) {
  const ripple = useSharedValue(0);
  useEffect(() => {
    ripple.value = withTiming(1, { duration: RIPPLE_MS, easing: Easing.out(Easing.quad) });
  }, [ripple]);
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - ripple.value),
    transform: [{ scale: 1 + ripple.value * 0.9 }],
  }));
  const at = { left: mark.x - DOT_SIZE / 2, top: mark.y - DOT_SIZE / 2 };
  return (
    <>
      <Animated.View style={[styles.ripple, at, rippleStyle]} />
      <Animated.View
        entering={ZoomIn.duration(90)}
        exiting={FadeOut.duration(220)}
        style={[styles.dot, at]}
      />
    </>
  );
}

function SwipeMark({ mark }: { mark: Swipe }) {
  const y = useSharedValue(mark.fromY);
  useEffect(() => {
    // A thumb's drag speeds up, then the finger leaves the glass while the list glides on.
    y.value = withTiming(mark.toY, { duration: mark.dragMs, easing: Easing.in(Easing.quad) });
  }, [mark, y]);
  const style = useAnimatedStyle(() => ({ top: y.value - DOT_SIZE / 2 }));
  return (
    <Animated.View
      entering={ZoomIn.duration(90)}
      exiting={FadeOut.duration(SWIPE_LIFT_MS)}
      style={[styles.dot, { left: mark.x - DOT_SIZE / 2 }, style]}
    />
  );
}

export function TapDots() {
  const [marks, setMarks] = useState<Mark[]>([]);
  useEffect(() => {
    const add = (mark: Mark) => {
      setMarks((shown) => [...shown, mark]);
      const shownMs = mark.kind === 'tap' ? TAP_SHOWN_MS : mark.dragMs;
      setTimeout(() => setMarks((shown) => shown.filter(({ id }) => id !== mark.id)), shownMs);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {marks.map((mark) =>
        mark.kind === 'tap' ? <TapMark key={mark.id} mark={mark} /> : <SwipeMark key={mark.id} mark={mark} />,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: 'rgba(40,44,52,0.42)',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  ripple: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(40,44,52,0.6)',
  },
});

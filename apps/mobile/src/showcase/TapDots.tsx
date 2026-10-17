import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, ZoomIn } from 'react-native-reanimated';

// Scripted presses have no finger, so the film would show buttons reacting by themselves; a soft dot where a
// finger would have landed reads as a person using the app.
type Dot = { id: number; x: number; y: number };

const DOT_SIZE = 46;
const DOT_SHOWN_MS = 420;

let nextId = 1;
const listeners = new Set<(dot: Dot) => void>();

/** Shows a touch dot at the centre of a control's window frame. */
export function showTap(frame: { x: number; y: number; width: number; height: number } | null): void {
  if (frame === null) return;
  const dot = { id: nextId++, x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  for (const listener of listeners) listener(dot);
}

export function TapDots() {
  const [dots, setDots] = useState<Dot[]>([]);
  useEffect(() => {
    const add = (dot: Dot) => {
      setDots((shown) => [...shown, dot]);
      setTimeout(() => setDots((shown) => shown.filter(({ id }) => id !== dot.id)), DOT_SHOWN_MS);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {dots.map((dot) => (
        <Animated.View
          key={dot.id}
          entering={ZoomIn.duration(120)}
          exiting={FadeOut.duration(220)}
          style={[styles.dot, { left: dot.x - DOT_SIZE / 2, top: dot.y - DOT_SIZE / 2 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
  },
});

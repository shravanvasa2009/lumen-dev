import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import nitinPractice from './recordings/nitin-practice.mp4';
import nitinScan from './recordings/nitin-scan.mp4';
import shravanPractice from './recordings/shravan-practice.mp4';
import shravanScan from './recordings/shravan-scan.mp4';

// The camera video of each person's finger, recorded with the take (tools/showcase/finger-video.mjs). It starts on
// the take's first frame, so the floor, the finger landing and the held finger line up with the replayed beats.
// The A17 plays Shravan's, the iPhone Nitin's (people.ts).
export type Take = 'practice' | 'scan';

const ios = Platform.OS === 'ios';
const VIDEOS: Record<Take, number> = {
  practice: ios ? nitinPractice : shravanPractice,
  scan: ios ? nitinScan : shravanScan,
};

// The scan film always shows Lumen coaching a slipped finger, whatever the take recorded (owner, 2026-10-25): in
// these seconds of the scan take, from its first frame, the replay's colours become a fingertip half off the lens
// (scanSource.ts) and the finger video slides that share of the dial aside. tools/showcase/check-timing.mjs mirrors it.
export const SLIP = { fromS: 42, toS: 46 };
const SLIP_SHARE = 0.45;
const SLIP_SLIDE_MS = 250;

// Checked once a second; a video more than this far from the take's clock is moved back onto it.
const RESYNC_EVERY_MS = 1000;
const MAX_DRIFT_S = 0.25;

type Playing = { take: Take; startedMs: number };
let playing: Playing | null = null;
const listeners = new Set<() => void>();

function publish(next: Playing | null) {
  playing = next;
  listeners.forEach((listener) => listener());
}

/** Starts the take's finger video now; called when the take's replay starts emitting frames. */
export function startFilmVideo(take: Take): void {
  publish({ take, startedMs: Date.now() });
}

export function stopFilmVideo(): void {
  publish(null);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Stands in for the live camera view in the dial during a showcase film.
export function FilmFingerVideo({ style }: ViewProps) {
  const film = useSyncExternalStore(subscribe, () => playing);
  const player = useVideoPlayer(film === null ? null : VIDEOS[film.take], (created) => {
    created.muted = true;
    created.loop = false;
  });
  const slide = useSharedValue(0);
  const slid = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));
  const width = Number(StyleSheet.flatten(style)?.width ?? 0);
  useEffect(() => {
    slide.value = 0;
    if (film?.take !== 'scan') return;
    const slideTo = (share: number) => () => {
      slide.value = withTiming(share * width, { duration: SLIP_SLIDE_MS });
    };
    const elapsedMs = Date.now() - film.startedMs;
    const timers = [
      setTimeout(slideTo(SLIP_SHARE), SLIP.fromS * 1000 - elapsedMs),
      setTimeout(slideTo(0), SLIP.toS * 1000 - elapsedMs),
    ];
    return () => timers.forEach(clearTimeout);
  }, [film, slide, width]);
  useEffect(() => {
    if (film === null) return;
    const takeSeconds = () => (Date.now() - film.startedMs) / 1000;
    player.currentTime = takeSeconds();
    player.play();
    const timer = setInterval(() => {
      if (Math.abs(player.currentTime - takeSeconds()) > MAX_DRIFT_S) player.currentTime = takeSeconds();
    }, RESYNC_EVERY_MS);
    return () => clearInterval(timer);
  }, [film, player]);
  return (
    <Animated.View style={[style, slid]}>
      <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />
    </Animated.View>
  );
}

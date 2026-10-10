import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

import { loadReadProgress, saveReadProgress } from './readProgress';

// Within this many dp of the end counts as having read to the end.
const END_SLACK_DP = 24;

function reportFailure(reason: unknown) {
  console.warn(`Reading progress was not saved: ${reason instanceof Error ? reason.message : String(reason)}`);
}

// Tracks how far down a chapter the person has scrolled, saves the furthest point, and puts them back
// where they stopped the last time.
export function useReportReading(slug: string) {
  const scroller = useRef<ScrollView>(null);
  const furthest = useRef(0);
  const saved = useRef(0);
  const viewportHeight = useRef(0);
  const restored = useRef(false);

  const flush = useCallback(() => {
    if (furthest.current <= saved.current) return;
    saved.current = furthest.current;
    saveReadProgress(slug, furthest.current).catch(reportFailure);
  }, [slug]);

  useEffect(() => flush, [flush]);

  const noteOffset = (offsetY: number, contentHeight: number) => {
    if (contentHeight <= 0 || viewportHeight.current <= 0) return;
    const bottom = offsetY + viewportHeight.current;
    const percent = bottom >= contentHeight - END_SLACK_DP ? 100 : Math.floor((bottom / contentHeight) * 100);
    furthest.current = Math.max(furthest.current, percent);
    if (furthest.current === 100) flush();
  };

  const restore = (contentHeight: number) => {
    restored.current = true;
    loadReadProgress()
      .then((progress) => {
        const percent = progress[slug] ?? 0;
        furthest.current = Math.max(furthest.current, percent);
        saved.current = Math.max(saved.current, percent);
        if (percent > 0 && percent < 100) {
          const top = Math.max(0, (percent / 100) * contentHeight - viewportHeight.current);
          scroller.current?.scrollTo({ y: top, animated: false });
        }
      })
      .catch(reportFailure);
  };

  return {
    ref: scroller,
    scrollEventThrottle: 100,
    onLayout: (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
    },
    onContentSizeChange: (_width: number, contentHeight: number) => {
      if (!restored.current) restore(contentHeight);
      noteOffset(0, contentHeight);
    },
    onScroll: ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) =>
      noteOffset(nativeEvent.contentOffset.y, nativeEvent.contentSize.height),
    onScrollEndDrag: flush,
    onMomentumScrollEnd: flush,
  };
}

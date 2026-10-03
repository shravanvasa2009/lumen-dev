import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { ReplayCapture } from '../../modules/lumen-capture/src';

import { useDemoActive } from '@/demo/demoSession';
import { syntheticDemoRecording } from '@/demo/syntheticRecording';
import { CaptureView } from '@/measure/CaptureView';
import { cleanSecondsNeeded, parseMode, processingHref } from '@/measure/mode';
import { useLiveCapture } from '@/measure/useLiveCapture';

const DEMO_LEAD_IN_S = 10;

export default function CaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string; context?: string }>();
  const mode = parseMode(params.mode);
  const demo = useDemoActive();
  // Demo mode has no camera: a generated recording plays through the same live session. The extra seconds
  // cover the frames before the first clean second.
  const replay = useMemo(
    () =>
      demo ? new ReplayCapture(syntheticDemoRecording(cleanSecondsNeeded(mode) + DEMO_LEAD_IN_S)) : null,
    [demo, mode],
  );
  const live = useLiveCapture(demo ? replay : undefined, demo);

  // Only the clean-seconds count ends a reading, never a timer (spec §7).
  const complete = live.cleanSeconds !== null && live.cleanSeconds >= cleanSecondsNeeded(mode);
  useEffect(() => {
    if (complete) router.replace(processingHref(mode, params.restDone, params.context));
  }, [complete, router, mode, params.restDone, params.context]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CaptureView
        mode={mode}
        live={live}
        onCancel={() => router.replace('/')}
        onStop={() => router.replace(`/measure/inconclusive?mode=${mode}`)}
      />
    </>
  );
}

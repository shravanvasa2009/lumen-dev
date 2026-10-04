import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { ReplayCapture } from '../../modules/lumen-capture/src';

import { planPhone } from '@/checks/checkPlan';
import { isDemoActive } from '@/demo/demoSession';
import { syntheticDemoRecording } from '@/demo/syntheticRecording';
import { CaptureView } from '@/measure/CaptureView';
import { cleanSecondsNeeded, parseMode, processingHref } from '@/measure/mode';
import { useLiveCapture } from '@/measure/useLiveCapture';
import { useStoredRating } from '@/store/useStoredRating';

const DEMO_LEAD_IN_S = 10;

export default function CaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string; context?: string }>();
  const mode = parseMode(params.mode);
  // Read once: leaving demo from the bar must not swap this running capture for the real camera.
  const [demo] = useState(isDemoActive);
  // Demo mode has no camera: a generated recording plays through the same live session. The extra seconds
  // cover the frames before the first clean second.
  const replay = useMemo(
    () =>
      demo ? new ReplayCapture(syntheticDemoRecording(cleanSecondsNeeded(mode) + DEMO_LEAD_IN_S)) : null,
    [demo, mode],
  );
  const live = useLiveCapture(demo ? replay : undefined, { demo });
  const rating = useStoredRating();

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
        phone={planPhone(rating)}
        onCancel={() => router.replace('/')}
        onStop={() => router.replace(`/measure/inconclusive?mode=${mode}`)}
      />
    </>
  );
}

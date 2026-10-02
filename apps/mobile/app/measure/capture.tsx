import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { CaptureView } from '@/measure/CaptureView';
import { cleanSecondsNeeded, parseMode, processingHref } from '@/measure/mode';
import { useLiveCapture } from '@/measure/useLiveCapture';

export default function CaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string; context?: string }>();
  const mode = parseMode(params.mode);
  const live = useLiveCapture();

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

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { parseMode } from '@/measure/mode';
import { ProcessingView } from '@/measure/ProcessingView';
import { useReadingAnalysis } from '@/measure/useReadingAnalysis';

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string }>();
  const mode = parseMode(params.mode);
  const analysis = useReadingAnalysis({
    mode,
    restTimerDone: params.restDone === 'true',
  });

  const readingId = analysis.phase === 'done' ? analysis.readingId : null;
  useEffect(() => {
    if (readingId !== null) router.replace(`/results/${readingId}`);
  }, [readingId, router]);

  const refused = analysis.phase === 'inconclusive';
  // The Inconclusive route takes the mode only; it has no parameter for the reason yet.
  useEffect(() => {
    if (refused) router.replace(`/measure/inconclusive?mode=${mode}`);
  }, [refused, router, mode]);

  return <ProcessingView analysis={analysis} mode={mode} />;
}

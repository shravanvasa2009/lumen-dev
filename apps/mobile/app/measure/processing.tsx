import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { handOverInconclusive } from '@/measure/inconclusiveHandoff';
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
  const outcome = analysis.phase === 'inconclusive' ? analysis.outcome : null;
  useEffect(() => {
    if (!refused) return;
    handOverInconclusive(outcome);
    router.replace(`/measure/inconclusive?mode=${mode}`);
  }, [refused, outcome, mode, router]);

  return <ProcessingView analysis={analysis} mode={mode} />;
}

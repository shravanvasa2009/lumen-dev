import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { parseMode } from '@/measure/mode';
import { ProcessingView } from '@/measure/ProcessingView';
import { useReadingAnalysis } from '@/measure/useReadingAnalysis';

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string; context?: string }>();
  const analysis = useReadingAnalysis({
    mode: parseMode(params.mode),
    restDone: params.restDone,
    context: params.context,
  });

  const readingId = analysis.phase === 'done' ? analysis.readingId : null;
  useEffect(() => {
    if (readingId !== null) router.replace(`/results/${readingId}`);
  }, [readingId, router]);

  return <ProcessingView analysis={analysis} />;
}

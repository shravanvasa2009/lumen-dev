import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { ProcessingView } from '@/measure/ProcessingView';
import { useReadingAnalysis } from '@/measure/useReadingAnalysis';

export default function ProcessingScreen() {
  const router = useRouter();
  const analysis = useReadingAnalysis();

  const readingId = analysis.phase === 'done' ? analysis.readingId : null;
  useEffect(() => {
    if (readingId !== null) router.replace(`/results/${readingId}`);
  }, [readingId, router]);

  return <ProcessingView analysis={analysis} />;
}

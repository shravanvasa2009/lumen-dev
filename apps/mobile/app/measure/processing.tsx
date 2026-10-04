import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { handOverInconclusive } from '@/measure/inconclusiveHandoff';
import { parseMode } from '@/measure/mode';
import { ProcessingView } from '@/measure/ProcessingView';
import { useReadingAnalysis } from '@/measure/useReadingAnalysis';
import { SafetySheet } from '@/results/SafetySheet';

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; restDone?: string }>();
  const mode = parseMode(params.mode);
  const analysis = useReadingAnalysis({
    mode,
    restTimerDone: params.restDone === 'true',
  });
  const [symptomsAnswered, setSymptomsAnswered] = useState(false);

  // SAFE-1 (ADR 0076): the urgent heart-rate flags win over the outcome kind, so a refused capture can still
  // open Emergency. A sustained fast rate goes straight there; a rate under 40 asks the symptom question first.
  const urgent =
    analysis.phase === 'done'
      ? analysis.urgent
      : analysis.phase === 'inconclusive'
        ? (analysis.outcome?.urgent ?? null)
        : null;
  const emergencyNow = urgent?.fastSustained === true;
  const askSymptoms = !emergencyNow && urgent?.slowBelow40 === true && !symptomsAnswered;
  useEffect(() => {
    if (emergencyNow) router.replace('/emergency');
  }, [emergencyNow, router]);

  const mayContinue = !emergencyNow && !askSymptoms;

  const readingId = analysis.phase === 'done' ? analysis.readingId : null;
  useEffect(() => {
    if (readingId !== null && mayContinue) router.replace(`/results/${readingId}`);
  }, [readingId, mayContinue, router]);

  const refused = analysis.phase === 'inconclusive';
  const outcome = analysis.phase === 'inconclusive' ? analysis.outcome : null;
  useEffect(() => {
    if (!refused || !mayContinue) return;
    handOverInconclusive(outcome);
    router.replace(`/measure/inconclusive?mode=${mode}`);
  }, [refused, mayContinue, outcome, mode, router]);

  return (
    <>
      <ProcessingView analysis={analysis} mode={mode} />
      <SafetySheet
        visible={askSymptoms}
        onDismiss={() => setSymptomsAnswered(true)}
        onYes={() => router.replace('/emergency')}
      />
    </>
  );
}

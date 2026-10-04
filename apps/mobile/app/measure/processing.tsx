import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

import { handOverInconclusive } from '@/measure/inconclusiveHandoff';
import { parseMode } from '@/measure/mode';
import { ProcessingView } from '@/measure/ProcessingView';
import { useReadingAnalysis } from '@/measure/useReadingAnalysis';
import { SafetySheet } from '@/results/SafetySheet';
import { markSymptomsAsked } from '@/results/symptomsAsked';

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
    analysis.phase === 'done' || analysis.phase === 'failed' || analysis.phase === 'running'
      ? analysis.urgent
      : analysis.phase === 'inconclusive'
        ? (analysis.outcome?.urgent ?? null)
        : null;

  // SAFE-1: only this screen routes on an urgent rate, so it cannot be left until the rules have run (urgent
  // is undefined until then): no header back, no iOS swipe-back, and the Android back press is eaten. After
  // that the routing below needs no further analysis step, so leaving is harmless.
  const analysing = analysis.phase === 'running' && urgent === undefined;
  useEffect(() => {
    if (!analysing) return;
    const block = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => block.remove();
  }, [analysing]);
  const emergencyNow = urgent?.fastSustained === true;
  const askSymptoms = !emergencyNow && urgent?.slowBelow40 === true && !symptomsAnswered;
  useEffect(() => {
    if (emergencyNow) router.replace('/emergency');
  }, [emergencyNow, router]);

  const mayContinue = !emergencyNow && !askSymptoms;
  const askedHere = urgent?.slowBelow40 === true && symptomsAnswered;

  const readingId = analysis.phase === 'done' ? analysis.readingId : null;
  useEffect(() => {
    if (readingId === null || !mayContinue) return;
    // Results asks the same question for a flagged rate, so it is told this reading was already asked.
    if (askedHere) markSymptomsAsked(readingId);
    router.replace(`/results/${readingId}`);
  }, [readingId, mayContinue, askedHere, router]);

  const refused = analysis.phase === 'inconclusive';
  const outcome = analysis.phase === 'inconclusive' ? analysis.outcome : null;
  useEffect(() => {
    if (!refused || !mayContinue) return;
    handOverInconclusive(outcome);
    router.replace(`/measure/inconclusive?mode=${mode}`);
  }, [refused, mayContinue, outcome, mode, router]);

  return (
    <>
      <Stack.Screen options={{ headerBackVisible: !analysing, gestureEnabled: !analysing }} />
      <ProcessingView analysis={analysis} mode={mode} />
      <SafetySheet
        visible={askSymptoms}
        onDismiss={() => setSymptomsAnswered(true)}
        onYes={() => router.replace('/emergency')}
      />
    </>
  );
}

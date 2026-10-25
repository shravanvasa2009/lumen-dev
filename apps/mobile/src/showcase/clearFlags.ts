import type { InconclusiveOutcome, ReadingResult, UrgentHeartRate } from '@lumen/core';

import type { AnalysedReading } from '@/measure/analyzeKeptCapture';

// SHOWCASE builds only: the film shows a regular reading on both phones, so a recorded scan that the rules
// flag (a recording artifact, or a lower-quality tag from the A17's frame rate) is shown as clean. Every
// cleared item is logged, so a rehearsal shows what the real analysis said.

const report = (cleared: string[]) => {
  if (cleared.length > 0) console.warn(`[showcase] cleared ${cleared.join(', ')}`);
};

function describeUrgent(urgent: UrgentHeartRate | null): string[] {
  if (urgent === null) return [];
  return [
    ...(urgent.fastSustained ? ['urgent fastSustained'] : []),
    ...(urgent.slowBelow40 ? ['urgent slowBelow40'] : []),
  ];
}

// SAFE-1 routes on this alone, so it is cleared before the rest of the analysis finishes.
export function showcaseUrgent(urgent: UrgentHeartRate | null): UrgentHeartRate | null {
  report(describeUrgent(urgent));
  return null;
}

export function showcaseOutcome(outcome: InconclusiveOutcome): InconclusiveOutcome {
  report(describeUrgent(outcome.urgent));
  return { ...outcome, urgent: null };
}

const standardFields = () => ({ quality: 'standard' as const, qualityReasons: [], qualityDetails: [] });

function standard<M extends { quality: string; confidence?: string }>(
  name: string,
  metric: M | null,
  cleared: string[],
): M | null {
  if (metric === null) return null;
  if (metric.quality !== 'standard') cleared.push(`${name} lower quality`);
  if (metric.confidence !== undefined && metric.confidence !== 'high')
    cleared.push(`${name} ${metric.confidence} confidence`);
  return {
    ...metric,
    ...standardFields(),
    ...(metric.confidence === undefined ? {} : { confidence: 'high' }),
  };
}

export function showcaseResult(reading: ReadingResult): ReadingResult {
  const cleared: string[] = [];
  const { hr, rhythm, rmssd, resp, diabetes } = reading.metrics;
  if (hr?.flag) cleared.push(`HR flag ${hr.flag}`);
  if (rhythm?.flag) cleared.push(`rhythm flag ${rhythm.flag}`);
  if (rhythm && rhythm.class !== 'sinus') cleared.push(`rhythm class ${rhythm.class}`);
  if (diabetes?.flag) cleared.push(`diabetes flag ${diabetes.flag}`);
  if (reading.quality.level !== 'standard')
    cleared.push(`quality ${reading.quality.reasons.map((reason) => reason.kind).join('+')}`);
  if (reading.retakePrompt !== null) cleared.push(`retake prompt ${reading.retakePrompt}`);
  if (reading.experimental.extraBeatsPerMin > 0)
    cleared.push(`extra beats ${reading.experimental.extraBeatsPerMin.toFixed(1)}/min`);
  // With no rhythm metric the reading cannot read as regular; it stays heart-rate only.
  const headlineKey = rhythm === null ? reading.headlineKey : 'result.regular';
  if (headlineKey !== reading.headlineKey) cleared.push(`headline ${reading.headlineKey}`);
  if (rhythm === null) console.warn('[showcase] the reading has no rhythm result; it shows heart rate only');
  const metrics: ReadingResult['metrics'] = {
    hr: hr && standard('HR', { ...hr, flag: null }, cleared),
    rhythm: rhythm && standard('rhythm', { ...rhythm, class: 'sinus', flag: null }, cleared),
    rmssd: standard('RMSSD', rmssd, cleared),
    resp: standard('breathing', resp, cleared),
    diabetes: diabetes && standard('diabetes', { ...diabetes, flag: null }, cleared),
  };
  const cleaned: ReadingResult = {
    ...reading,
    headlineKey,
    quality: { level: 'standard', reasons: [] },
    retakePrompt: null,
    metrics,
    experimental: { ...reading.experimental, ...standardFields(), extraBeatsPerMin: 0 },
  };
  report(cleared);
  return cleaned;
}

export function showcaseReading(analysed: AnalysedReading): AnalysedReading {
  return { ...analysed, reading: showcaseResult(analysed.reading), urgent: showcaseUrgent(analysed.urgent) };
}

import { analyzeReading, buildReadingResult, type ReadingResult } from '@lumen/core';

import evidence from '../../assets/evidence.json';
import { syntheticDemoRecording } from '../demo/syntheticRecording';
import { showcaseOutcome, showcaseResult, showcaseUrgent } from './clearFlags';

const PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };

// A real 90 s analysis of the demo pulse, so every field the clearing leaves alone is the core's own.
function analysedReading(): ReadingResult {
  const { samples, stats } = syntheticDemoRecording(100);
  const rows = samples.tNs.map((tNs, i) => ({ tNs, r: samples.r[i]!, g: samples.g[i]!, b: samples.b[i]! }));
  const frameStats = (stats?.tNs ?? []).map((tNs, i) => ({
    tNs,
    spatialStdR: stats!.spatialStdR[i]!,
    clipFrac: stats!.clipFrac[i]!,
    exposureNs: stats!.exposureNs[i]!,
  }));
  const analysis = analyzeReading(
    { samples: rows, stats: frameStats },
    {
      captureFps: 60,
      tier: 'full',
      mode: 'full',
      restTimerDone: false,
      recordedAt: null,
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
      validationRhythmLabel: null,
    },
  );
  return buildReadingResult(analysis, { rhythm: null, diabetes: null }, evidence, PROFILE, []);
}

function flagged(reading: ReadingResult): ReadingResult {
  const hr = reading.metrics.hr!;
  const low = { quality: 'low' as const, qualityReasons: ['lowFps' as const], qualityDetails: [] };
  return {
    ...reading,
    headlineKey: 'result.possibleAf',
    quality: { level: 'low', reasons: [{ kind: 'lowFps', fps: 22, wantFps: 30 }] },
    retakePrompt: 'shortFast',
    metrics: {
      ...reading.metrics,
      hr: { ...hr, ...low, flag: 'fastRegular' },
      rhythm: {
        ...low,
        class: 'af',
        pAF: 0.9,
        evidence: 'experimental',
        confidence: 'moderate',
        flag: 'possibleAf',
      },
    },
  };
}

describe('showcase clearing', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('shows a flagged, lower-quality reading as regular and logs what it cleared', () => {
    const base = analysedReading();
    const cleaned = showcaseResult(flagged(base));
    expect(cleaned.headlineKey).toBe('result.regular');
    expect(cleaned.quality).toEqual({ level: 'standard', reasons: [] });
    expect(cleaned.retakePrompt).toBeNull();
    expect(cleaned.metrics.hr).toMatchObject({ flag: null, quality: 'standard', qualityReasons: [] });
    expect(cleaned.metrics.hr?.value).toBe(base.metrics.hr?.value);
    expect(cleaned.metrics.rhythm).toMatchObject({ class: 'sinus', flag: null, quality: 'standard' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[showcase] cleared HR flag fastRegular'));
    expect(warn.mock.calls[0]?.[0]).toEqual(expect.stringContaining('rhythm flag possibleAf'));
  });

  it('logs nothing for a reading that is already clean', () => {
    const once = showcaseResult(flagged(analysedReading()));
    warn.mockClear();
    expect(showcaseResult(once)).toEqual(once);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never lets an urgent heart rate reach SAFE-1 routing', () => {
    expect(showcaseUrgent({ fastSustained: true, slowBelow40: false })).toBeNull();
    expect(warn).toHaveBeenCalledWith('[showcase] cleared urgent fastSustained');
    const outcome = showcaseOutcome({
      kind: 'inconclusive',
      reasons: [],
      cleanSeconds: 20,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 0, pressure: 0, coverage: 0, coldHands: 0 },
      otherLostSeconds: 0,
      causes: [],
      urgent: { fastSustained: false, slowBelow40: true },
    });
    expect(outcome.urgent).toBeNull();
  });
});

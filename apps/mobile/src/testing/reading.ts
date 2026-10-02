import type { ReadingResult } from '@lumen/core';

import type { StoredReading } from '@/home/readings';

export function makeReading(takenAt: number, hr: number | null, rmssd: number | null): StoredReading {
  const outcome: ReadingResult = {
    headlineKey: 'result.regular',
    cleanSeconds: 90,
    beats: 100,
    rejectedBeats: 0,
    metrics: {
      hr:
        hr === null
          ? null
          : { value: hr, unit: 'bpm', evidence: 'experimental', confidence: 'high', flag: null },
      rhythm: null,
      rmssd:
        rmssd === null
          ? null
          : { value: rmssd, unit: 'ms', band: null, evidence: 'experimental', confidence: 'high' },
      resp: null,
      diabetes: null,
    },
    experimental: { extraBeatsPerMin: 0, longPauses: 0, pulseShape: { available: false } },
    lostSeconds: { motion: 0, pressure: 0, coverage: 0, coldHands: 0 },
    notChecked: ['bp', 'spo2', 'heartAttack'],
  };
  return { takenAt, outcome };
}

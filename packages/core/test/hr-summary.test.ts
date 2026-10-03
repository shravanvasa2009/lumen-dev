import { hrSummary, type ClassifiedBeat } from '../src';

// 61 normal beats with intervals alternating 0.8 s and 0.9 s: 60 NN intervals, none dropped by the 20%
// filter (each is within 6% of its neighbours' median 0.85 s). Same beats as
// ml/lumen_dsp/tests/test_hr_summary.py.
function alternatingBeats(): ClassifiedBeat[] {
  let peakS = 1;
  return Array.from({ length: 61 }, (_, i) => {
    if (i > 0) peakS += i % 2 === 1 ? 0.8 : 0.9;
    return { peakS, onsetS: peakS - 0.08, beatClass: 'normal', longPause: false };
  });
}

describe('ML-6 diabetes-net HR/HRV summary (hand-computed answers)', () => {
  it('gives HR, RMSSD, SDNN, and pNN50 over the normal beats', () => {
    const summary = hrSummary([alternatingBeats()], 'sinus', 60, 300);
    expect(summary).toHaveLength(4);
    expect(summary[0]).toBeCloseTo(60 / 0.85, 9); // median of 30 × 0.8 and 30 × 0.9
    expect(summary[1]).toBeCloseTo(100, 9); // every successive difference is ±100 ms
    // Mean 0.85 s; 60 squared deviations of 0.05² over n − 1 = 59.
    expect(summary[2]).toBeCloseTo(1000 * Math.sqrt((60 * 0.05 ** 2) / 59), 9);
    expect(summary[3]).toBe(1); // all 59 differences exceed 50 ms
  });

  it('keeps HR but nulls HRV when the rhythm is not sinus (DSP-12 gating)', () => {
    const summary = hrSummary([alternatingBeats()], 'af', 60, 300);
    expect(summary[0]).toBeCloseTo(60 / 0.85, 9);
    expect(summary.slice(1)).toEqual([null, null, null]);
  });

  it('nulls HRV when the rhythm model abstained or gave no card', () => {
    expect(hrSummary([alternatingBeats()], 'uncertain', 60, 300).slice(1)).toEqual([null, null, null]);
    expect(hrSummary([alternatingBeats()], null, 60, 300).slice(1)).toEqual([null, null, null]);
  });

  it('nulls HRV below 60 fps and SDNN below 300 clean seconds', () => {
    expect(hrSummary([alternatingBeats()], 'sinus', 30, 300).slice(1)).toEqual([null, null, null]);
    const shorter = hrSummary([alternatingBeats()], 'sinus', 60, 120);
    expect(shorter[1]).toBeCloseTo(100, 9);
    expect(shorter[2]).toBeNull();
    expect(shorter[3]).toBe(1);
  });

  it('is all null below 15 clean seconds', () => {
    expect(hrSummary([alternatingBeats()], 'sinus', 60, 10)).toEqual([null, null, null, null]);
  });
});

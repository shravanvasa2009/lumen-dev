/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { DSP_CONFIG, classifyBeats, detectBeats, elgendiPeaks, type RejectedSpan } from '../src';

// DSP-7/8/9 against python -m lumen_dsp.golden. Both sides run the same loops in the same order using
// only +, −, ×, ÷ on the same doubles (no libm), so peaks, onsets, upslopes, amplitudes, and classes must
// match exactly. Read at run time, not imported, so a missing file fails here with the fix instead of
// breaking compilation.
const GOLDEN_PATH = path.join(__dirname, 'golden', 'beats.json');
const GENERATE = 'cd ml && uv run python -m lumen_dsp.golden';

interface BeatCase {
  name: string;
  firstIndex256: number;
  morphology256: number[];
  spans: RejectedSpan[];
  expected: {
    elgendiPeaks64: number[];
    detected: { peakS: number; onsetS: number | null; maxUpslope: number; amplitude: number }[];
    classified: { beatClass: string; longPause: boolean }[];
  };
}

function loadCases(): BeatCase[] {
  if (!fs.existsSync(GOLDEN_PATH))
    throw new Error(`${GOLDEN_PATH} is missing; the owner generates it with: ${GENERATE}`);
  return (JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as { cases: BeatCase[] }).cases;
}

describe('DSP-C golden parity: DSP-7/8/9 beats and classes', () => {
  it('has the golden file', () => {
    expect(loadCases().length).toBeGreaterThan(0);
  });

  // Without the file only the test above runs (and fails with the fix); jest rejects an empty table.
  const cases = fs.existsSync(GOLDEN_PATH) ? loadCases() : [];
  if (cases.length === 0) return;
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_, golden) => {
    const shapeValues = Float64Array.from(golden.morphology256);
    // The model-rate input is every fourth shape-rate sample, as the generator builds it.
    const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
    const step = shapeRateHz / modelRateHz;
    const model = {
      firstIndex: golden.firstIndex256 / step,
      values: shapeValues.filter((_, k) => k % step === 0),
    };
    const shape = { firstIndex: golden.firstIndex256, values: shapeValues };

    expect(elgendiPeaks(model.values, modelRateHz)).toEqual(golden.expected.elgendiPeaks64);
    const detected = detectBeats(model, shape);
    expect(detected).toEqual(golden.expected.detected);
    const classified = classifyBeats(detected, shape, golden.spans);
    expect(classified.map(({ beatClass, longPause }) => ({ beatClass, longPause }))).toEqual(
      golden.expected.classified,
    );
  });
});

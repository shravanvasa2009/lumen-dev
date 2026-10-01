import { DSP_CONFIG, sqiModelInput } from '../src';
import zscoreGolden from './golden/zscore.json';

// DSP-3 z-scored SQI-Net v1 inputs (ADR 0023: −R only, 256 samples) against python -m lumen_dsp.golden.
// Both sides run the same operations in the same order and round to float32, so inputs match exactly.
describe('DSP-C golden parity: DSP-3 per-window z-score', () => {
  it('uses the configured window length', () => {
    expect(zscoreGolden.windowSamples).toBe(DSP_CONFIG.dsp3.modelWindowS * DSP_CONFIG.dsp2.modelRateHz);
  });

  const scored = zscoreGolden.windows.filter((window) => window.input !== null);
  const flat = zscoreGolden.windows.filter((window) => window.input === null);

  it.each(scored)('window at 64 Hz index $firstIndex', ({ primary, input }) => {
    expect(Array.from(sqiModelInput(primary)!)).toEqual(input);
  });

  it('gives no input for the flat window (all samples equal)', () => {
    expect(flat).toHaveLength(1);
    expect(sqiModelInput(flat[0]!.primary)).toBeNull();
  });
});

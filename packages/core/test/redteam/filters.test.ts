import { butterBandpass, CausalFilter, DSP_CONFIG, filterZeroPhase } from '../../src';

const { modelRateHz } = DSP_CONFIG.dsp2;
const { hrOrder, hrBandHz } = DSP_CONFIG.dsp6;
const [lowHz, highHz] = hrBandHz as [number, number];
const hrBand = () => butterBandpass(hrOrder, lowHz, highHz, modelRateHz);

// Bilinear Butterworth band-pass: |H|² = 1 / (1 + x^2N), x = |Ω² − ΩlΩh| / (Ω(Ωh − Ωl)), Ω = tan(πf/fs).
// Zero-phase filtering applies |H| twice, so a sine comes out scaled by |H|².
function zeroPhaseGain(frequencyHz: number): number {
  const warp = (hz: number) => Math.tan((Math.PI * hz) / modelRateHz);
  const omega = warp(frequencyHz);
  const x = Math.abs(omega ** 2 - warp(lowHz) * warp(highHz)) / (omega * (warp(highHz) - warp(lowHz)));
  return 1 / (1 + x ** (2 * hrOrder));
}

// Amplitude (√2 · RMS) over the middle 20 s of 60 s, a whole number of periods for every frequency here.
function measuredGain(frequencyHz: number): number {
  const sine = Float64Array.from({ length: 60 * modelRateHz }, (_, k) =>
    Math.sin((2 * Math.PI * frequencyHz * k) / modelRateHz),
  );
  const middle = filterZeroPhase(hrBand(), sine).subarray(20 * modelRateHz, 40 * modelRateHz);
  return Math.sqrt((2 * middle.reduce((total, value) => total + value * value, 0)) / middle.length);
}

describe('red team: DSP-6 HR band', () => {
  // 0.6 and 3.5 Hz are the −6 dB zero-phase edges (ADR 0018); 0.3 Hz is a breathing-rate baseline; 10 and
  // 20 Hz are where 100 Hz light flicker aliases at 30 and 60 fps.
  it.each([0.3, 0.6, 1.2, 2.0, 3.5, 10, 20])('scales a %s Hz sine by the analytic |H|²', (frequencyHz) => {
    const expected = zeroPhaseGain(frequencyHz);
    expect(Math.abs(measuredGain(frequencyHz) - expected)).toBeLessThanOrEqual(
      Math.max(1e-4, 0.01 * expected),
    );
  });

  it('puts the band edges at −6 dB (gain 0.5) when run forward-backward', () => {
    expect(zeroPhaseGain(lowHz)).toBeCloseTo(0.5, 12);
    expect(zeroPhaseGain(highHz)).toBeCloseTo(0.5, 12);
  });

  it('rejects light flicker aliased to 10 Hz and 20 Hz by more than 60 dB', () => {
    expect(measuredGain(10)).toBeLessThan(1e-3);
    expect(measuredGain(20)).toBeLessThan(1e-3);
  });

  it('settles after an exposure step 0.60 → 0.70: below 1% of the step 5 s later, both sides', () => {
    const stepped = Float64Array.from({ length: 30 * modelRateHz }, (_, k) =>
      k < 15 * modelRateHz ? 0.6 : 0.7,
    );
    const filtered = filterZeroPhase(hrBand(), stepped);
    expect(Math.abs(filtered[10 * modelRateHz]!)).toBeLessThan(0.001);
    expect(Math.abs(filtered[20 * modelRateHz]!)).toBeLessThan(0.001);
  });

  it('throws RangeError for a NaN sample rate', () => {
    expect(() => butterBandpass(hrOrder, lowHz, highHz, NaN)).toThrow(RangeError);
  });

  it('throws RangeError for an empty signal', () => {
    expect(() => filterZeroPhase(hrBand(), [])).toThrow(RangeError);
  });
});

describe('red team: DSP-6 causal live filter', () => {
  it('gives the same output fed one sample at a time with empty batches between', () => {
    const signal = Float64Array.from(
      { length: 640 },
      (_, k) => 1.0 - 0.006 * Math.sin((2 * Math.PI * 1.2 * k) / 64),
    );
    const whole = new CausalFilter(hrBand()).filter(signal);
    const live = new CausalFilter(hrBand());
    const pieces = Array.from(signal, (value) => [...live.filter([]), ...live.filter([value])]).flat();
    expect(Float64Array.from(pieces)).toEqual(whole);
  });

  it('starts at rest on a red clipped at 1.0: a constant gives 0 within 1e-12', () => {
    for (const value of new CausalFilter(hrBand()).filter(new Float64Array(640).fill(1.0)))
      expect(Math.abs(value)).toBeLessThan(1e-12);
  });
});

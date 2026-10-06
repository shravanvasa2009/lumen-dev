import {
  butterBandpass,
  butterLowpass,
  CausalFilter,
  displayPulse,
  DSP_CONFIG,
  filterZeroPhase,
} from '../src';

const FPS = 30;
// The rate displayPulse derives from the frame times, for building the same reference filter.
const rateOf = (tS: number[]) => (tS.length - 1) / (tS.at(-1)! - tS[0]!);
const SHOWN_S = DSP_CONFIG.live.waveformS;
const gaussian = (tS: number, centreS: number, sigmaS: number) =>
  Math.exp(-0.5 * ((tS - centreS) / sigmaS) ** 2);

// A fingertip pulse with a strong dicrotic wave `secondRatio` of the systolic height, `secondAt` of a beat after
// it, run through the session's causal band-pass as the live graph gets it; the last 6 s are returned.
function livePulse(bpm: number, secondRatio = 0.9, secondAt = 0.45) {
  const periodS = 60 / bpm;
  const totalS = 20;
  const peaksS: number[] = [];
  for (let peakS = 0.3; peakS < totalS + 1; peakS += periodS) peaksS.push(peakS);
  const sigmaS = Math.min(0.06, periodS / 8);
  const raw = Array.from({ length: totalS * FPS }, (_, k) => {
    const tS = k / FPS;
    return peaksS.reduce(
      (sum, peakS) =>
        sum +
        gaussian(tS, peakS, sigmaS) +
        secondRatio * gaussian(tS, peakS + secondAt * periodS, sigmaS * 1.3),
      0,
    );
  });
  const [lowHz, highHz] = DSP_CONFIG.dsp6.morphologyBandHz as [number, number];
  const filtered = new CausalFilter(
    butterBandpass(DSP_CONFIG.dsp6.morphologyOrder, lowHz, highHz, FPS),
  ).filter(raw);
  const first = (totalS - SHOWN_S) * FPS;
  return {
    tS: Array.from({ length: SHOWN_S * FPS }, (_, k) => (first + k) / FPS),
    ppg: Array.from(filtered.slice(first)),
    periodS,
  };
}

// Local maxima away from the edges, where the zero-phase padding can bend the trace.
function maximaTimes(tS: number[], trace: number[], marginS: number): number[] {
  const times: number[] = [];
  for (let i = 1; i < trace.length - 1; i++)
    if (
      trace[i]! > trace[i - 1]! &&
      trace[i]! >= trace[i + 1]! &&
      tS[i]! - tS[0]! >= marginS &&
      tS.at(-1)! - tS[i]! >= marginS
    )
      times.push(tS[i]!);
  return times;
}

function expectOneBumpPerBeat(tS: number[], trace: number[], periodS: number) {
  const maxima = maximaTimes(tS, trace, periodS / 2);
  const innerS = tS.at(-1)! - tS[0]! - periodS;
  expect(maxima.length).toBeGreaterThanOrEqual(Math.floor(innerS / periodS));
  expect(maxima.length).toBeLessThanOrEqual(Math.ceil(innerS / periodS));
  // Peaks land on frames, so two neighbours can be up to two frames off one period.
  for (let k = 1; k < maxima.length; k++)
    expect(Math.abs(maxima[k]! - maxima[k - 1]! - periodS)).toBeLessThanOrEqual(2 / FPS + 1e-9);
}

describe('displayPulse (display only)', () => {
  it.each([45, 60, 75, 90, 120, 150])('draws one bump per beat at %d bpm with the right live rate', (bpm) => {
    const { tS, ppg, periodS } = livePulse(bpm);
    // The band-passed trace still has the second bump, which is why the display trace exists.
    expect(maximaTimes(tS, ppg, periodS / 2).length).toBeGreaterThan(
      Math.ceil((SHOWN_S - periodS) / periodS),
    );
    expectOneBumpPerBeat(tS, displayPulse(tS, ppg, bpm), periodS);
  });

  it.each([45, 50, 60, 70])('keeps one bump per beat at %d bpm when the live rate is locked on 2×', (bpm) => {
    const { tS, ppg, periodS } = livePulse(bpm, 0.95, 0.45);
    expectOneBumpPerBeat(tS, displayPulse(tS, ppg, 2 * bpm), periodS);
  });

  it.each([80, 100, 120])('does not halve a true %d bpm rate', (bpm) => {
    const { tS, ppg, periodS } = livePulse(bpm, 0.3, 0.4);
    expectOneBumpPerBeat(tS, displayPulse(tS, ppg, bpm), periodS);
  });

  it('low-passes at the fixed fallback cutoff when there is no live rate', () => {
    const { tS, ppg } = livePulse(70);
    const { order, fallbackCutoffHz } = DSP_CONFIG.displayPulse;
    const expected = filterZeroPhase(butterLowpass(order, fallbackCutoffHz, rateOf(tS)), ppg);
    expect(displayPulse(tS, ppg, null)).toEqual(Array.from(expected));
    expect(displayPulse(tS, ppg, Number.NaN)).toEqual(Array.from(expected));
  });

  it('clamps the cutoff to its range for rates outside the live band', () => {
    const { tS, ppg } = livePulse(70);
    const { order, cutoffRangeHz } = DSP_CONFIG.displayPulse;
    const [lowHz, highHz] = cutoffRangeHz as [number, number];
    expect(displayPulse(tS, ppg, 400)).toEqual(
      Array.from(filterZeroPhase(butterLowpass(order, highHz, rateOf(tS)), ppg)),
    );
    expect(displayPulse(tS, ppg, 20)).toEqual(
      Array.from(filterZeroPhase(butterLowpass(order, lowHz, rateOf(tS)), ppg)),
    );
  });

  it('returns a copy unchanged when the trace is too short to filter, and never changes its input', () => {
    expect(displayPulse([0, 0.03, 0.07], [1, 2, 3], 70)).toEqual([1, 2, 3]);
    expect(displayPulse([], [], null)).toEqual([]);
    const { tS, ppg } = livePulse(70);
    const before = [...ppg];
    displayPulse(tS, ppg, 70);
    expect(ppg).toEqual(before);
  });

  it('returns the input unchanged rather than NaN when a value is not finite', () => {
    const { tS, ppg } = livePulse(70);
    ppg[40] = Number.NaN;
    expect(displayPulse(tS, ppg, 70)).toEqual(ppg);
  });
});

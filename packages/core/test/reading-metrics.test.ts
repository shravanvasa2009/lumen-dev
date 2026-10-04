import {
  classifyBeats,
  cleanSeconds,
  detectBeats,
  DSP_CONFIG,
  heartRate,
  hrv,
  measureBeats,
  perfusionIndex,
  type BeatClass,
  type ClassifiedBeat,
  type DetectedBeat,
  type MeasuredBeat,
  type ResampledSegment,
} from '../src';
import { morphologySegment, parkMillerUniforms } from './synthetic';

// One segment of beats ending each interval in `intervalsS`, all normal unless `classes` says otherwise.
function beatsFrom(
  intervalsS: number[],
  classes: Record<number, BeatClass> = {},
  longPauses: number[] = [],
  firstS = 1,
): MeasuredBeat[] {
  const times = [firstS];
  for (const intervalS of intervalsS) times.push(times[times.length - 1]! + intervalS);
  return times.map((peakS, i) => ({
    peakS,
    onsetS: peakS - 0.1,
    beatClass: classes[i] ?? 'normal',
    longPause: longPauses.includes(i),
    amplitude: 0.004,
    intensity: -0.62,
    dc: -0.62,
  }));
}

const sorted = (values: number[]) => [...values].sort((x, y) => x - y);
function medianOf(values: number[]): number {
  const ordered = sorted(values);
  const middle = ordered.length >> 1;
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

describe('clean seconds', () => {
  it('is the reading length when nothing is rejected', () => {
    expect(cleanSeconds(2, 92, [])).toBe(90);
  });

  it('subtracts the union of rejected spans, clipped to the reading', () => {
    const spans = [
      { startS: 10, endS: 14, reason: 'motion' as const },
      { startS: 12, endS: 15, reason: 'quality' as const }, // overlaps the first: counted once
      { startS: 0, endS: 3, reason: 'coverage' as const }, // starts before the reading
      { startS: 90, endS: 99, reason: 'exposure' as const }, // ends after it
      { startS: 40, endS: 40, reason: 'clipping' as const }, // zero length
    ];
    // Reading 2..92: lost 10..15 (5 s), 2..3 (1 s), 90..92 (2 s).
    expect(cleanSeconds(2, 92, spans)).toBeCloseTo(82, 12);
  });

  it('is zero when one span covers the whole reading', () => {
    expect(cleanSeconds(0, 30, [{ startS: -1, endS: 31, reason: 'motion' }])).toBe(0);
  });
});

describe('DSP-11 heart rate', () => {
  it('reads 72 bpm from a regular 72 bpm rhythm', () => {
    expect(heartRate([beatsFrom(new Array(30).fill(60 / 72))], 30)).toBeCloseTo(72, 9);
  });

  it('is 60 / the median interval on AF-like irregular intervals, which are all kept', () => {
    const intervalsS = parkMillerUniforms(80, 4242).map((u) => 0.4 + 0.8 * u);
    expect(heartRate([beatsFrom(intervalsS)], 70)).toBeCloseTo(60 / medianOf(intervalsS), 9);
  });

  it('keeps atypical beats and long pauses, and drops both intervals touching an artifact beat', () => {
    // Intervals 0.8 s except two: 0.5 s ending at atypical beat 5, 0.3 s ending at artifact beat 10.
    const intervalsS = new Array(30).fill(0.8);
    intervalsS[4] = 0.5;
    intervalsS[9] = 0.3;
    intervalsS[10] = 0.3;
    const beats = beatsFrom(intervalsS, { 5: 'atypical', 10: 'artifact' }, [15]);
    const kept = intervalsS.filter((_, k) => k !== 9 && k !== 10);
    expect(heartRate([beats], 20)).toBeCloseTo(60 / medianOf(kept), 9);
  });

  it('skips "not a beat" candidates: the interval runs between the beats around them', () => {
    // Beats every 1 s with a not-a-beat candidate 0.3 s after beat 3: intervals stay 1 s, so 60 bpm.
    const beats = beatsFrom(new Array(20).fill(1));
    const candidate: MeasuredBeat = { ...beats[3]!, peakS: beats[3]!.peakS + 0.3, beatClass: 'not-a-beat' };
    expect(heartRate([[...beats.slice(0, 4), candidate, ...beats.slice(4)]], 20)).toBeCloseTo(60, 9);
  });

  it('never makes an interval across two segments', () => {
    // Each segment is regular at 60 bpm; the 4 s gap between them must not count.
    const first = beatsFrom(new Array(10).fill(1), {}, [], 1);
    const second = beatsFrom(new Array(10).fill(1), {}, [], 15);
    expect(heartRate([first, second], 20)).toBeCloseTo(60, 9);
  });

  it('needs 15 clean seconds and at least one interval', () => {
    const beats = beatsFrom(new Array(20).fill(0.8));
    expect(DSP_CONFIG.dsp11.minCleanS).toBe(15);
    expect(heartRate([beats], 14.999)).toBeNull();
    expect(heartRate([beats], NaN)).toBeNull();
    expect(heartRate([beats], 15)).toBeCloseTo(75, 9);
    expect(heartRate([beatsFrom([])], 60)).toBeNull();
    expect(heartRate([beatsFrom(new Array(25).fill(0.8), { 25: 'artifact' })], 60)).toBeCloseTo(75, 9);
  });

  // Red team PR #171 round 3: 35 clean s with one accepted 0.3 s interval read 201 bpm. DSP-11's 15 s is
  // also the time the accepted intervals behind the median must span (ADR 0080).
  it('needs 15 s of accepted intervals behind the median, wherever the clean seconds are', () => {
    expect(heartRate([beatsFrom([0.3])], 35)).toBeNull();
    expect(heartRate([beatsFrom(new Array(18).fill(0.8))], 60)).toBeNull(); // 14.4 s
    expect(heartRate([beatsFrom(new Array(19).fill(0.8))], 60)).toBeCloseTo(75, 9); // 15.2 s
    // Two segments of 7.5 s each, regular at 60 bpm: 15 s together.
    const first = beatsFrom(new Array(7).fill(1).concat(0.5), {}, [], 1);
    const second = beatsFrom(new Array(7).fill(1).concat(0.5), {}, [], 20);
    expect(heartRate([first, second], 60)).toBeCloseTo(60, 9);
    expect(heartRate([first, second.slice(0, -1)], 60)).toBeNull(); // 14.5 s
    // Intervals touching an artifact beat do not count toward the 15 s.
    const withArtifact = beatsFrom(new Array(20).fill(0.8), { 10: 'artifact' }); // 16 s, 14.4 s accepted
    expect(heartRate([withArtifact], 60)).toBeNull();
  });

  it('leaves out zero and negative intervals (a beat detected twice, or out of order)', () => {
    expect(heartRate([beatsFrom([0])], 60)).toBeNull();
    // Ten 0.8 s, then 0 and −0.1, then ten 0.9 s: the median of the positive ones is 0.85 (with the other
    // two it would be 0.8).
    const intervalsS = [...new Array(10).fill(0.8), 0, -0.1, ...new Array(10).fill(0.9)];
    expect(heartRate([beatsFrom(intervalsS)], 60)).toBeCloseTo(60 / 0.85, 9);
  });
});

describe('DSP-10 perfusion index', () => {
  it('is 100 × amplitude / |DC| for a known AC/DC', () => {
    const beats = beatsFrom(new Array(40).fill(1)).map((beat) => ({ ...beat, amplitude: 0.005, dc: -0.62 }));
    expect(perfusionIndex([beats], 40)).toBeCloseTo((100 * 0.005) / 0.62, 12);
  });

  it('takes the median over normal beats only, across segments', () => {
    const amplitudes = [0.004, 0.006, 0.005, 0.1, 0.0001];
    const classes: BeatClass[] = ['normal', 'normal', 'normal', 'atypical', 'artifact'];
    const beats = beatsFrom([1, 1, 1, 1]).map((beat, i) => ({
      ...beat,
      beatClass: classes[i]!,
      amplitude: amplitudes[i]!,
      dc: -0.5,
    }));
    const later = beatsFrom([1], {}, [], 20).map((beat) => ({ ...beat, amplitude: 0.007, dc: -0.5 }));
    // Normal beats: 0.8%, 1.2%, 1.0%, 1.4%, 1.4% → median 1.2%.
    expect(perfusionIndex([beats, later], 30)).toBeCloseTo(1.2, 12);
  });

  it('needs 30 clean seconds (§6.2) and at least one normal beat', () => {
    const beats = beatsFrom(new Array(40).fill(1));
    expect(DSP_CONFIG.dsp10.minCleanS).toBe(30);
    expect(perfusionIndex([beats], 29.9)).toBeNull();
    expect(perfusionIndex([beats], NaN)).toBeNull();
    expect(
      perfusionIndex([beats.map((beat) => ({ ...beat, beatClass: 'atypical' as const }))], 40),
    ).toBeNull();
  });

  it('measures about 100 × 0.004 / 0.62 % from a camera-like 90 bpm sine riding on a 0.62 red level', () => {
    // −R = −0.62 + 0.002 sin(2π · 1.5 t): peak-to-trough 0.004 on a 0.62 DC. 90 bpm puts the trough
    // 0.33 s before the peak, inside DSP-8's 0.4 s foot search.
    const seconds = 40;
    const pulseHz = 1.5;
    const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
    const rawAt = (rateHz: number) =>
      Float64Array.from(
        { length: seconds * rateHz },
        (_, k) => -0.62 + 0.002 * Math.sin(2 * Math.PI * pulseHz * (k / rateHz)),
      );
    const raw: ResampledSegment = { firstIndex: 0, values: rawAt(shapeRateHz) };
    const model = morphologySegment(rawAt(modelRateHz), modelRateHz);
    const shape = morphologySegment(raw.values, shapeRateHz);
    const detected = detectBeats(model, shape);
    const measured = measureBeats(detected, classifyBeats(detected, shape, []), raw);
    // Zero-phase gain of the order-2 Butterworth 0.5–8 Hz band-pass: |H|² = 1 / (1 + x⁴) with
    // x = (f² − f_low·f_high) / (f·(f_high − f_low)) (analog prototype; the 256 Hz prewarp is negligible).
    const [lowHz, highHz] = DSP_CONFIG.dsp6.morphologyBandHz as [number, number];
    const x = (pulseHz ** 2 - lowHz * highHz) / (pulseHz * (highHz - lowHz));
    const bandGain = 1 / (1 + x ** 4);
    expect(perfusionIndex([measured], seconds)).toBeCloseTo((100 * 0.004 * bandGain) / 0.62, 3);
  });
});

describe('measureBeats', () => {
  it('carries the DSP-8 amplitude and reads intensity and DSP-3 DC at the peak sample', () => {
    const { shapeRateHz } = DSP_CONFIG.dsp2;
    // Raw −R: a slow ramp from −0.70 to −0.50 over 20 s, starting at sample 512 (2 s).
    const raw: ResampledSegment = {
      firstIndex: 512,
      values: Float64Array.from(
        { length: 20 * shapeRateHz },
        (_, k) => -0.7 + (0.2 * k) / (20 * shapeRateHz),
      ),
    };
    const detected: DetectedBeat[] = [
      { peakS: 5, onsetS: 4.9, maxUpslope: 1, amplitude: 0.003 },
      { peakS: 12.0019, onsetS: 11.9, maxUpslope: 1, amplitude: 0.004 },
    ];
    const classified: ClassifiedBeat[] = detected.map((beat) => ({
      peakS: beat.peakS,
      onsetS: beat.onsetS,
      beatClass: 'normal',
      longPause: false,
    }));
    const measured = measureBeats(detected, classified, raw);
    // 5 s is sample 5 · 256 − 512 = 768; 12.0019 s rounds to 3072.49 → 3072 − 512 = 2560.
    expect(measured[0]).toMatchObject({ peakS: 5, amplitude: 0.003, intensity: raw.values[768] });
    expect(measured[1]!.intensity).toBe(raw.values[2560]);
    // A ramp passes the zero-phase low-pass unchanged away from the ends.
    expect(measured[0]!.dc).toBeCloseTo(raw.values[768]!, 4);
    expect(measured[1]!.dc).toBeCloseTo(raw.values[2560]!, 4);
  });

  it('rejects beat lists of different lengths', () => {
    const raw: ResampledSegment = { firstIndex: 0, values: new Float64Array(256) };
    expect(() =>
      measureBeats([], [{ peakS: 0.5, onsetS: null, beatClass: 'normal', longPause: false }], raw),
    ).toThrow(RangeError);
  });
});

describe('DSP-12 HRV', () => {
  const alternating = (count: number, low: number, high: number) =>
    Array.from({ length: count }, (_, k) => (k % 2 === 0 ? low : high));

  it('gives RMSSD 40 ms, SDNN 20·√(n/(n−1)) ms, and pNN50 0 for intervals alternating 0.80/0.84 s', () => {
    const intervalsS = alternating(400, 0.8, 0.84); // 328 s
    const values = hrv([beatsFrom(intervalsS)], 'sinus', 60, 330)!;
    expect(values.nnIntervals).toBe(400);
    expect(values.rmssdMs).toBeCloseTo(40, 9);
    expect(values.sdnnMs).toBeCloseTo(20 * Math.sqrt(400 / 399), 9);
    expect(values.pnn50).toBe(0);
  });

  it('counts successive differences strictly over 50 ms in pNN50', () => {
    expect(hrv([beatsFrom(alternating(80, 0.8, 0.86))], 'sinus', 60, 70)!.pnn50).toBe(1);
    // 80 successive differences of 60, 40, 40, 60 ms repeating: half are over 50 ms.
    const mixed = Array.from({ length: 81 }, (_, k) => [0.8, 0.86, 0.82, 0.86][k % 4]!);
    expect(hrv([beatsFrom(mixed)], 'sinus', 60, 70)!.pnn50).toBe(0.5);
  });

  it('drops an interval > 20% from the median of ±5 neighbours, and pairs no differences across it', () => {
    const intervalsS = alternating(80, 0.8, 0.84);
    // Its ±5 neighbours hold six 0.84 s and four 0.80 s intervals, median 0.84 s: 1.2 s is 43% above.
    intervalsS[40] = 1.2;
    const values = hrv([beatsFrom(intervalsS)], 'sinus', 60, 70)!;
    expect(values.nnIntervals).toBe(79);
    expect(values.rmssdMs).toBeCloseTo(40, 9);
  });

  it('keeps an interval 19% from the median and drops one 21% from it', () => {
    const at = (ratio: number) => {
      const intervalsS = alternating(80, 0.8, 0.84);
      // Index 41's ±5 neighbours hold six 0.80 s and four 0.84 s intervals: median 0.80 s.
      intervalsS[41] = 0.8 * ratio;
      return hrv([beatsFrom(intervalsS)], 'sinus', 60, 70)!.nnIntervals;
    };
    expect(at(1.19)).toBe(80);
    expect(at(0.81)).toBe(80);
    expect(at(1.21)).toBe(79);
    expect(at(0.79)).toBe(79);
  });

  it('uses normal-to-normal intervals only: no interval touching an atypical or artifact beat, no long pause', () => {
    const intervalsS = alternating(90, 0.8, 0.84);
    const beats = beatsFrom(intervalsS, { 20: 'atypical', 50: 'artifact' }, [70]);
    // Lost: intervals 19 and 20 (atypical beat 20), 49 and 50 (artifact beat 50), and 69 (long pause at 70).
    const values = hrv([beats], 'sinus', 60, 75)!;
    expect(values.nnIntervals).toBe(85);
    expect(values.rmssdMs).toBeCloseTo(40, 9);
  });

  it('runs only when the rhythm class is sinus and the capture is at ≥ 60 fps', () => {
    const beats = [beatsFrom(alternating(80, 0.8, 0.84))];
    expect(DSP_CONFIG.dsp12.minFps).toBe(60);
    expect(hrv(beats, 'af', 60, 70)).toBeNull();
    expect(hrv(beats, 'other', 60, 70)).toBeNull();
    expect(hrv(beats, 'sinus', 59.9, 70)).toBeNull();
    expect(hrv(beats, 'sinus', NaN, 70)).toBeNull();
    expect(hrv(beats, 'sinus', 60, 70)).not.toBeNull();
  });

  it('needs 60 clean s and 50 intervals for RMSSD and pNN50, and 300 clean s for SDNN', () => {
    const fifty = [beatsFrom(alternating(50, 0.8, 0.84))];
    expect(hrv(fifty, 'sinus', 60, 60)!.rmssdMs).toBeCloseTo(40, 9);
    expect(hrv(fifty, 'sinus', 60, 59.9)).toMatchObject({ rmssdMs: null, pnn50: null, sdnnMs: null });
    const fortyNine = [beatsFrom(alternating(49, 0.8, 0.84))];
    expect(hrv(fortyNine, 'sinus', 60, 120)).toMatchObject({ rmssdMs: null, pnn50: null, sdnnMs: null });

    const long = [beatsFrom(alternating(400, 0.8, 0.84))];
    expect(hrv(long, 'sinus', 60, 299.9)!.sdnnMs).toBeNull();
    expect(hrv(long, 'sinus', 60, 299.9)!.rmssdMs).toBeCloseTo(40, 9);
    expect(hrv(long, 'sinus', 60, 300)!.sdnnMs).not.toBeNull();
  });

  it('pairs successive differences only within a segment', () => {
    // Two segments of 0.8 s intervals whose levels differ by 0.2 s: no 200 ms difference across the gap.
    const values = hrv(
      [beatsFrom(new Array(30).fill(0.8)), beatsFrom(new Array(30).fill(1), {}, [], 40)],
      'sinus',
      60,
      65,
    )!;
    expect(values.nnIntervals).toBe(60);
    expect(values.rmssdMs).toBeCloseTo(0, 9);
  });
});

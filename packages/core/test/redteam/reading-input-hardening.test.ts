import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  type CaptureStatus,
  type LiveSession,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
} from '../../src';
import { captureAt, regularOffsets, type SyntheticCapture } from '../synthetic';
import { beatTimes, beatTrain, flatRed, seededNormal, sinePulse, type Channels } from './attacks';

// Red team for the PR #120 reading-input hardening (ADR 0057 follow-up): non-finite frames as coverage,
// splines over finite runs only, FlatRuns, the clamped first window, the live filter hold, and the setSqi
// guard. The invariant: for any frame stream, live rejectedSpans and clean seconds equal analyzeReading's
// on readingInput(), and neither throws.

const SQI_THRESHOLD = 0.5;
// One 8-bit step of a 0..1 channel mean.
const LSB = 1 / 255;
// beatTrain(beatTimes([RR_S])) is a regular rhythm at 60 / RR_S = 75 bpm.
const RR_S = 0.8;
const TRUE_BPM = 60 / RR_S;

const still: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 60,
  droppedFrac: 0,
};

interface ReplayOptions {
  moving?: (tS: number) => boolean;
  // A stand-in SQI-Net score for each new sqiWindow, as the app would call setSqi; none when omitted.
  score?: (endS: number) => number;
}

const secondsOf = (tNs: number, capture: SyntheticCapture) => (tNs - capture.samples[0]!.tNs) / 1e9;

// 100 ms batches and a 4 Hz status, as the capture module sends them (as in reading-input.test.ts).
function replay(capture: SyntheticCapture, captureFps: number, options: ReplayOptions = {}): LiveSession {
  const session = createLiveSession({
    captureFps,
    sqiThreshold: SQI_THRESHOLD,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let nextStatusS = 0;
  let scoredEndS: number | null = null;
  for (let start = 0; start < capture.samples.length;) {
    const batchStartS = secondsOf(capture.samples[start]!.tNs, capture);
    let end = start + 1;
    while (end < capture.samples.length && secondsOf(capture.samples[end]!.tNs, capture) < batchStartS + 0.1)
      end++;
    session.pushSamples({
      samples: capture.samples.slice(start, end),
      stats: capture.stats.slice(start, end),
    });
    const lastS = secondsOf(capture.samples[end - 1]!.tNs, capture);
    while (nextStatusS <= lastS) {
      session.pushStatus({ ...still, motionRms: options.moving?.(nextStatusS) ? 0.2 : 0 });
      nextStatusS += 0.25;
    }
    const window = session.sqiWindow;
    if (options.score && window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, options.score(window.endS));
    }
    start = end;
  }
  return session;
}

function savedFrom(session: LiveSession, captureFps: number): ReadingAnalysis {
  const { capture, ...spans } = session.readingInput();
  const context: ReadingContext = {
    captureFps,
    tier: 'full',
    mode: 'full',
    restTimerDone: true,
    recordedAt: null,
    validationRhythmLabel: null,
    ...spans,
  };
  return analyzeReading(capture, context);
}

// The ADR 0057 invariant: identical spans, and the same true clean seconds.
function expectParity(session: LiveSession, captureFps: number): ReadingAnalysis {
  const saved = savedFrom(session, captureFps);
  expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
  expect(saved.cleanSeconds).toBe(cleanSeconds(0, saved.durationS, session.rejectedSpans));
  return saved;
}

const qualitySpans = (spans: RejectedSpan[]) => spans.filter((span) => span.reason === 'quality');

// Frame k of a regular capture at fps is at k / fps; patch the frames where isBad(k) holds.
const patchFrames =
  (
    base: Channels,
    fps: number,
    isBad: (k: number) => boolean,
    patch: Partial<ReturnType<Channels>>,
  ): Channels =>
  (tS) => {
    const frame = base(tS);
    return isBad(Math.round(tS * fps)) ? { ...frame, ...patch } : frame;
  };

// One frame in every `everyS` seconds (not the first), at the given fps.
const everyFrames = (fps: number, everyS: number) => {
  const period = Math.round(everyS * fps);
  return (k: number) => k > 0 && k % period === 0;
};

const heartBeats = (saved: ReadingAnalysis) =>
  saved.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');

describe('red team: setSqi arguments the whole-ns guard lets through', () => {
  const capture = captureAt(regularOffsets(60, 10), sinePulse(72));
  const scoredSession = (endS: number, pClean: number) => {
    const session = createLiveSession({
      captureFps: 60,
      sqiThreshold: SQI_THRESHOLD,
      perfusionFloorPct: 0.2,
    });
    session.pushSamples(capture);
    session.setSqi(endS, pClean);
    return session;
  };

  it('a NaN end is refused with a RangeError', () => {
    expect(() => scoredSession(NaN, 0.1)).toThrow(RangeError);
  });

  // Found by red team (live.ts:214). Math.round(±Infinity × 1e9) / 1e9 is ±Infinity again, so the guard
  // passes. Observed: a quality span {startS: ±Infinity, endS: ±Infinity} in rejectedSpans live and saved,
  // and readingInput().sqi.windows[0].endNs = ±Infinity, which JSON.stringify writes as null in a saved
  // result. Expected: setSqi refuses a non-finite end with a RangeError.
  it.each([Infinity, -Infinity])('an end of %s s is refused with a RangeError', (endS) => {
    expect(() => scoredSession(endS, 0.1)).toThrow(RangeError);
  });

  // Found by red team. 9002345.606197001 s (104 days after the first frame) is a whole ns by the guard,
  // but readingInput adds it to the capture start (5e12 ns here), and the sum, above 2^53 ns, rounds to
  // an even ns. Observed: live span ends at 9002345.606197001, saved at 9002345.606197. Expected: setSqi
  // refuses an end outside the reading, or live and saved agree.
  it('an end 104 days after the reading start: refused, or live and saved agree', () => {
    let session: LiveSession;
    try {
      session = scoredSession(9002345.606197001, 0.1);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      return;
    }
    expectParity(session, 60);
  });

  // Found by red team. A NaN P(clean) (a failed model run) fails `pClean < threshold`, so the window is
  // kept as clean, and readingInput hands on pClean NaN (null in JSON). Observed: no quality span for the
  // window ending at 8 s. Expected: setSqi refuses a P(clean) that is not a finite probability with a
  // RangeError, or the window is rejected.
  it('a NaN P(clean): refused, or the window is rejected', () => {
    let session: LiveSession;
    try {
      session = scoredSession(8, NaN);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      return;
    }
    expect(qualitySpans(session.rejectedSpans)).toEqual([{ startS: 4, endS: 8, reason: 'quality' }]);
  });
});

describe('red team: non-finite values in any channel or stat, at 30/60/120/240 fps', () => {
  const pulse = beatTrain(beatTimes([RR_S], 30));

  it.each([30, 60, 120, 240])(
    '%i fps, NaN green once a second: parity, and the heart rate is kept',
    (fps) => {
      const channels = patchFrames(pulse, fps, everyFrames(fps, 1), { g: NaN });
      const saved = expectParity(replay(captureAt(regularOffsets(fps, 30), channels), fps), fps);
      expect(Math.abs(saved.heartRateBpm! - TRUE_BPM)).toBeLessThan(1);
    },
  );

  it.each([30, 60, 120, 240])('%i fps, NaN blue and +Infinity red in turn: parity, no throw', (fps) => {
    const bad = everyFrames(fps, 0.7);
    const channels: Channels = (tS) => {
      const k = Math.round(tS * fps);
      if (!bad(k)) return pulse(tS);
      return k % 2 === 0 ? { ...pulse(tS), b: NaN } : { ...pulse(tS), r: Infinity };
    };
    expectParity(replay(captureAt(regularOffsets(fps, 20), channels), fps), fps);
  });

  it.each([30, 60, 120, 240])('%i fps, every other frame NaN red: parity, half the time rejected', (fps) => {
    const channels = patchFrames(pulse, fps, (k) => k % 2 === 1, { r: NaN });
    const saved = expectParity(replay(captureAt(regularOffsets(fps, 20), channels), fps), fps);
    expect(saved.cleanSeconds).toBeCloseTo(saved.durationS / 2, 1);
  });

  it.each([30, 60, 240])('%i fps, NaN red every 0.5 s inside a motion span: parity, motion kept', (fps) => {
    const channels = patchFrames(pulse, fps, everyFrames(fps, 0.5), { r: NaN });
    const session = replay(captureAt(regularOffsets(fps, 30), channels), fps, {
      moving: (tS) => tS >= 10 && tS < 15,
    });
    const saved = expectParity(session, fps);
    expect(
      saved.rejectedSpans.some((span) => span.reason === 'motion' && span.startS < 11 && span.endS > 14),
    ).toBe(true);
  });

  it.each([
    ['spatialStdR NaN', { spatialStdR: NaN }],
    ['clipFrac +Infinity', { clipFrac: Infinity }],
    ['exposureNs NaN', { exposureNs: NaN }],
  ])('%s on one frame a second: parity, no throw', (_label, patch) => {
    const capture = captureAt(regularOffsets(60, 20), pulse);
    const isBad = everyFrames(60, 1);
    const stats = capture.stats.map((stat, k) => (isBad(k) ? { ...stat, ...patch } : stat));
    expectParity(replay({ samples: capture.samples, stats }, 60), 60);
  });

  it('NaN red on the first frame: parity, no throw', () => {
    const channels = patchFrames(pulse, 60, (k) => k === 0, { r: NaN });
    expectParity(replay(captureAt(regularOffsets(60, 20), channels), 60), 60);
  });
});

// A NaN-red frame cuts the capture into separately splined runs (reading.ts beatSegments); the same
// frame simply dropped is splined across, as DSP-2 allows for gaps up to 150 ms.
describe('red team: single bad frames cutting the beat path', () => {
  const pulse = beatTrain(beatTimes([RR_S], 60));

  // Found by red team. Every finite run is under dsp7.minSegmentS (2 s), so no segment is searched for
  // beats. 240 fps, 60 s, NaN red on one frame every 1.5 s. Observed: 59.83 of 60 s clean, 0 beats,
  // heart rate null (the same frames dropped: 75.0 bpm). Every period ≤ ~1.9 s does this, at every fps.
  // Expected: one bad frame costs no more than the same frame dropped; the heart rate is 75 ± 1 bpm.
  it('240 fps, NaN red every 1.5 s: the heart rate is still read', () => {
    const channels = patchFrames(pulse, 240, everyFrames(240, 1.5), { r: NaN });
    const saved = savedFrom(replay(captureAt(regularOffsets(240, 60), channels), 240), 240);
    expect(saved.cleanSeconds).toBeGreaterThan(59);
    expect(saved.heartRateBpm).not.toBeNull();
    expect(Math.abs(saved.heartRateBpm! - TRUE_BPM)).toBeLessThan(1);
  });

  // Found by red team. Same cause: every finite run is one frame. 240 fps, 40 s, NaN red on every odd
  // frame. Observed: 20.0 of 40 s clean (over the 15 s DSP-11 minimum) and heart rate null. Dropping
  // the same frames leaves a 120 fps capture. Expected: 75 ± 1 bpm, as from that capture.
  it('240 fps, NaN red on every other frame for 40 s: the heart rate is still read', () => {
    const channels = patchFrames(pulse, 240, (k) => k % 2 === 1, { r: NaN });
    const saved = savedFrom(replay(captureAt(regularOffsets(240, 40), channels), 240), 240);
    expect(saved.cleanSeconds).toBeGreaterThan(15);
    expect(saved.heartRateBpm).not.toBeNull();
    expect(Math.abs(saved.heartRateBpm! - TRUE_BPM)).toBeLessThan(1);
  });

  it('control: the same frames dropped (240 fps, every 1.5 s) read 75 ± 1 bpm', () => {
    const isBad = everyFrames(240, 1.5);
    const offsets = regularOffsets(240, 60).filter((_, k) => !isBad(k));
    const saved = savedFrom(replay(captureAt(offsets, pulse), 240), 240);
    expect(Math.abs(saved.heartRateBpm! - TRUE_BPM)).toBeLessThan(1);
  });

  // Beat k of beatTimes starts at −2 + 0.8k s; the frame nearest its foot + 0.6 s is mid-diastole, far
  // from any onset-to-peak stretch, so the one-frame coverage span there touches no beat.
  const midDiastoleEvery = (fps: number, beatsApart: number) => {
    const frames = new Set(
      beatTimes([RR_S], 60)
        .filter((_, k) => k % beatsApart === 0)
        .map((footS) => Math.round((footS + 0.6) * fps)),
    );
    return (k: number) => k > 0 && frames.has(k);
  };

  // Found by red team. Each cut starts a new segment, and the first interval of every segment is flagged
  // as spanning an artifact, so no run reaches 32 intervals. 240 fps, 60 s, NaN red mid-diastole every
  // 4th beat (3.2 s). Observed: 0 rhythm windows; the same frames dropped give 3. Expected: the same
  // rhythm windows as with the frames dropped (no beat touches the one-frame spans).
  it('240 fps, NaN red mid-diastole every 3.2 s: as many rhythm windows as with the frames dropped', () => {
    const isBad = midDiastoleEvery(240, 4);
    const withNaN = savedFrom(
      replay(captureAt(regularOffsets(240, 60), patchFrames(pulse, 240, isBad, { r: NaN })), 240),
      240,
    );
    const offsets = regularOffsets(240, 60).filter((_, k) => !isBad(k));
    const dropped = savedFrom(replay(captureAt(offsets, pulse), 240), 240);
    expect(dropped.rhythmWindows.length).toBeGreaterThan(0);
    expect(withNaN.rhythmWindows.length).toBe(dropped.rhythmWindows.length);
  });

  // NaN red on the frame at the systolic peak of every 3rd beat (2.4 s apart). A lone bad frame is a
  // dropped frame, leaving a 2-frame gap (66.7 ms at 30 fps, 33.3 at 60, 8.3 at 240), within DSP-2's
  // 150 ms, so the capture is one segment. No beat may be doubled or lost around the bad frames.
  it.each([30, 60, 240])(
    '%i fps, NaN at every 3rd peak: no doubled beat, no interval across a cut',
    (fps) => {
      const peaksS = beatTimes([RR_S], 60).map((footS) => footS + 0.12);
      const cutFrames = new Set(peaksS.filter((_, k) => k % 3 === 0).map((peakS) => Math.round(peakS * fps)));
      const channels = patchFrames(pulse, fps, (k) => k > 0 && cutFrames.has(k), { r: NaN });
      const saved = expectParity(replay(captureAt(regularOffsets(fps, 60), channels), fps), fps);
      const detectedS = heartBeats(saved)
        .map((beat) => beat.peakS)
        .sort((x, y) => x - y);
      expect(saved.segments.length).toBe(1);
      for (let i = 1; i < detectedS.length; i++)
        expect(detectedS[i]! - detectedS[i - 1]!).toBeGreaterThan(0.4);
      for (const peakS of detectedS)
        expect(Math.min(...peaksS.map((trueS) => Math.abs(trueS - peakS)))).toBeLessThan(0.05);
      for (const interval of saved.intervals) expect(Math.abs(interval.ibiMs - 1000 * RR_S)).toBeLessThan(20);
      expect(Math.abs(saved.heartRateBpm! - TRUE_BPM)).toBeLessThan(1);
    },
  );

  // NaN red at 30, 60, and 90 s. One frame leaves a gap of 2 / 240 s = 8.3 ms, within DSP-2's 150 ms:
  // one segment. 48 frames (200 ms) leave 49 / 240 s = 204 ms, over 150 ms: a cut at each, 4 segments.
  it.each([
    ['one frame', 1, 1],
    ['200 ms of frames', 48, 4],
  ])(
    '240 fps, 95 s, %s of NaN red every 30 s: DSP-2 segments; no rhythm window spans a cut',
    (_label, badFrames, segments) => {
      const period = 30 * 240;
      const isBad = (k: number) => k >= period && k % period < badFrames;
      const channels = patchFrames(pulse, 240, isBad, { r: NaN });
      const saved = expectParity(replay(captureAt(regularOffsets(240, 95), channels), 240), 240);
      // Index of the interval from each segment's last beat to the next segment's first.
      const crossings: number[] = [];
      let beatsBefore = 0;
      for (const segment of saved.segments) {
        if (beatsBefore > 0) crossings.push(beatsBefore - 1);
        beatsBefore += segment.filter((beat) => beat.beatClass !== 'not-a-beat').length;
      }
      expect(saved.segments.length).toBe(segments);
      expect(saved.rhythmWindows.length).toBeGreaterThan(0);
      const { windowIntervals } = DSP_CONFIG.dsp15;
      for (const window of saved.rhythmWindows) {
        const inWindow = (index: number) =>
          index >= window.startInterval && index < window.startInterval + windowIntervals;
        expect(crossings.filter(inWindow)).toEqual([]);
      }
    },
  );
});

// Each window check needs 4 s of covered, gap-free frames, so a bad frame every few seconds means no
// window is ever scored or tested for flatness.
describe('red team: sparse bad frames keep SQI-Net from ever scoring', () => {
  // Covered red with white noise at a typical pulse size (σ 0.006) and no pulse; one draw per 60 fps frame.
  const draws = (() => {
    const normal = seededNormal(7);
    return Array.from({ length: 60 * 31 }, () => normal());
  })();
  const noise: Channels = (tS) => ({ r: 0.6 + 0.006 * draws[Math.round(tS * 60)]!, g: 0.1, b: 0.05 });
  const rejectAll = { score: () => 0.1 };
  const isBad = (k: number) => k % 180 === 90;

  // Owner 2026-10-06 made SQI-Net advisory, and on 2026-10-09 ruled that covered noise with no pulse may give a
  // heart rate as long as the reading is tagged lower quality. These 30 s of noise count about 30 clean s and
  // give 107.6 bpm, tagged sqiFlagged with every window flagged (26 of 26).
  it('advisory SQI-Net: noise scored unclean everywhere carries the tag on every window', () => {
    const offsets = regularOffsets(60, 30).filter((_, k) => !isBad(k));
    const saved = expectParity(replay(captureAt(offsets, noise), 60, rejectAll), 60);
    expect(saved.sqiFlagged!.windows).toBe(saved.sqiFlagged!.total);
    expect(saved.sqiFlagged!.total).toBeGreaterThan(0);
  });

  // Found by red team. 60 fps, 30 s of noise (no pulse), NaN red on one frame every 3 s (frames 90, 270,
  // …), and a stand-in SQI-Net that rejects every window it is given: 29.82 of 29.98 s clean and 112 bpm
  // from noise; with a finite one-frame coverage failure (finger off for 17 ms) every 3 s, 51.8 bpm. Under
  // the owner's 2026-10-09 ruling a rate from noise is acceptable only when the reading carries a
  // lower-quality tag: noSqi when no window was scored, sqiFlagged when one was.
  it.each([
    ['NaN red', { r: NaN }],
    ['finger off', { r: 0.2, g: 0.3, b: 0.3 }],
  ])('noise with one %s frame every 3 s is tagged lower quality', (_label, patch) => {
    const channels = patchFrames(noise, 60, isBad, patch);
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60, rejectAll), 60);
    const tagged = !saved.sqiAvailable || (saved.sqiFlagged?.windows ?? 0) > 0;
    expect(tagged).toBe(true);
  });

  // Found by red team. ADR 0057 clamps the first window to the first frame so [0, 1) is judged by the
  // window rule. A coverage first frame makes that window uncovered, and the first usable one is [0.98,
  // 5] at the 5 s check, so [1/60, 0.98] s is never scored. 60 fps, 72 bpm, NaN red on frame 0, SQI-Net
  // rejecting every window. Observed: 0.983 s of [0, 2] clean. Expected: under 0.05 s, as with a good
  // first frame (0.000).
  it('a NaN first frame: SQI-Net still judges the first second', () => {
    const channels = patchFrames(sinePulse(72), 60, (k) => k === 0, { r: NaN });
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60, rejectAll), 60);
    expect(cleanSeconds(0, 2, saved.rejectedSpans)).toBeLessThan(0.05);
  });

  // Advisory SQI-Net (owner 2026-10-06): scores reject nothing, so [0, 2] is as clean as with no scores at all.
  it('control: a good first frame, SQI-Net scoring every window low: [0, 2] as clean as unscored', () => {
    const pulse = captureAt(regularOffsets(60, 30), sinePulse(72));
    const saved = expectParity(replay(pulse, 60, rejectAll), 60);
    const unscored = expectParity(replay(pulse, 60), 60);
    expect(cleanSeconds(0, 2, saved.rejectedSpans)).toBe(cleanSeconds(0, 2, unscored.rejectedSpans));
  });
});

describe('red team: values a covered frame should not have', () => {
  // Found by red team. Sample channels are means on 0..1 (capture.ts), but DSP-4 has no upper bound, so
  // a frame reported on a 0–255 scale is covered. Its spike makes the Elgendi threshold (beta × mean of
  // the squared signal) so high that the whole segment loses its beats. 60 fps, 30 s of 72 bpm, one
  // frame at 10 s with r = 153. Observed: 29.98 s clean, 2 beats, heart rate null (r = 1.0 there: 72.0
  // bpm). Expected: one out-of-range frame costs about one frame; the heart rate is 72 ± 1 bpm.
  it('one frame with red on a 0–255 scale (153) does not wipe the reading', () => {
    const channels = patchFrames(sinePulse(72), 60, (k) => k === 600, { r: 153 });
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60), 60);
    expect(saved.heartRateBpm).not.toBeNull();
    expect(Math.abs(saved.heartRateBpm! - 72)).toBeLessThan(1);
  });

  it('one full-scale frame (r = 1.0) keeps the heart rate at 72 ± 1 bpm', () => {
    const channels = patchFrames(sinePulse(72), 60, (k) => k === 600, { r: 1 });
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60), 60);
    expect(Math.abs(saved.heartRateBpm! - 72)).toBeLessThan(1);
  });
});

describe('red team: FlatRuns (ADR 0057)', () => {
  // Red rounded to whole 8-bit steps, as a mean of one 8-bit pixel would be.
  const quantised =
    (amplitude: number): Channels =>
    (tS) => {
      const frame = sinePulse(72, amplitude)(tS);
      return { ...frame, r: Math.round(frame.r / LSB) * LSB };
    };

  // 0.002 of 0.6 is a 0.33% perfusion index, ±0.51 LSB: red holds one value for many frames at a time.
  it.each([30, 60, 240])('%i fps, a low-perfusion pulse rounded to 8 bits: no quality span', (fps) => {
    const saved = expectParity(replay(captureAt(regularOffsets(fps, 30), quantised(0.002)), fps), fps);
    expect(qualitySpans(saved.rejectedSpans)).toEqual([]);
    expect(Math.abs(saved.heartRateBpm! - 72)).toBeLessThan(1);
  });

  it('a pulse under half an 8-bit step rounds to constant red and is rejected', () => {
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), quantised(0.0015)), 60), 60);
    expect(saved.cleanSeconds).toBe(0);
  });

  it('constant red with a pulse in green: rejected as flat, red is the signal', () => {
    const greenPulse: Channels = (tS) => ({ r: 0.6, g: 0.1 + 0.005 * Math.sin(2.4 * Math.PI * tS), b: 0.05 });
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), greenPulse), 60), 60);
    expect(saved.cleanSeconds).toBe(0);
  });

  // Runs of exactly 2 covered frames between NaN-red frames (frames 3m + 1, 3m + 2 are covered).
  it.each([
    ['equal red in each pair', (k: number) => 0.6 + LSB * Math.floor(k / 3)],
    ['different red in each pair', (k: number) => 0.6 + LSB * (k % 3)],
  ])('30 fps, 2-frame runs, %s: parity', (_label, redOf) => {
    const channels: Channels = (tS) => {
      const k = Math.round(tS * 30);
      return k % 3 === 0 ? { r: NaN, g: 0.1, b: 0.05 } : { r: redOf(k), g: 0.1, b: 0.05 };
    };
    const saved = expectParity(replay(captureAt(regularOffsets(30, 10), channels), 30), 30);
    const flat = qualitySpans(saved.rejectedSpans);
    if (redOf(1) === redOf(2)) expect(flat).toHaveLength(100);
    else expect(flat).toEqual([]);
  });

  // The flat run ends at its last frame, so the one frame interval before the NaN frame stays clean.
  it('flat 0–2.5 s, a NaN frame, then a pulse: the flat start is rejected; parity', () => {
    const channels: Channels = (tS) =>
      tS < 2.5 ? flatRed(0.6)(tS) : tS === 2.5 ? { r: NaN, g: 0.1, b: 0.05 } : sinePulse(72)(tS);
    const saved = expectParity(replay(captureAt(regularOffsets(60, 20), channels), 60), 60);
    expect(cleanSeconds(0, 2.5, saved.rejectedSpans)).toBeLessThan(0.02);
  });

  it('flat 10–13 s bounded by NaN frames inside a pulse: rejected; parity', () => {
    const channels = patchFrames(
      (tS) => (tS >= 10 && tS < 13 ? flatRed(0.6)(tS) : sinePulse(72)(tS)),
      60,
      (k) => k === 600 || k === 780,
      { r: NaN },
    );
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60), 60);
    expect(cleanSeconds(10, 13, saved.rejectedSpans)).toBeLessThan(0.05);
  });

  // Found by red team. FlatRuns judges a whole covered run, and every 4 s window over 10–13 s holds some
  // pulse, so 3 s of constant red (a frozen camera feed) inside an unbroken pulse is never rejected
  // without SQI-Net, while the same stretch with one bad frame at each end is (test above). 60 fps, 30 s
  // of 72 bpm, red exactly 0.6 on 10–13 s. Observed: 3.0 of those 3 s clean. Expected: the flat stretch
  // is rejected as it is when bad frames bound it (under 0.5 s clean).
  it('flat 10–13 s inside an unbroken pulse is not counted clean', () => {
    const channels: Channels = (tS) => (tS >= 10 && tS < 13 ? flatRed(0.6)(tS) : sinePulse(72)(tS));
    const saved = expectParity(replay(captureAt(regularOffsets(60, 30), channels), 60), 60);
    expect(cleanSeconds(10, 13, saved.rejectedSpans)).toBeLessThan(0.5);
  });
});

describe('red team: the live waveform filter over non-finite frames', () => {
  const coldHandsSpans = (saved: ReadingAnalysis) =>
    saved.rejectedSpans.filter((span) => span.reason === 'coldHands');
  // The check needs the 4 s before a whole second covered; NaN red every 6 s leaves one or two such checks
  // between NaN frames (every 4.5 s would leave none).
  const nanEvery6 = (base: Channels) => patchFrames(base, 60, everyFrames(60, 6), { r: NaN });

  it('a healthy 1% pulse with NaN red every 6 s is never flagged cold hands', () => {
    const saved = expectParity(replay(captureAt(regularOffsets(60, 40), nanEvery6(sinePulse(72))), 60), 60);
    expect(coldHandsSpans(saved)).toEqual([]);
  });

  it('a 0.05% pulse with NaN red every 6 s is still flagged cold hands', () => {
    const faint = nanEvery6(sinePulse(72, 0.0003));
    const saved = expectParity(replay(captureAt(regularOffsets(60, 40), faint), 60), 60);
    expect(coldHandsSpans(saved).length).toBeGreaterThan(0);
  });
});

describe('red team: splining many finite runs stays fast', () => {
  // Best of two runs each, so a garbage collection in one run does not decide the ratio. 240 fps with
  // NaN red once a second: 360 finite runs to spline.
  it('360 s at 240 fps with NaN red every second costs under 10× a 90 s capture', () => {
    const analyzeMs = (seconds: number, everyS: number) => {
      // sinePulse, not beatTrain: beatTrain sums every beat at every frame, minutes of setup at this size.
      const channels = patchFrames(sinePulse(72), 240, everyFrames(240, everyS), { r: NaN });
      const session = replay(captureAt(regularOffsets(240, seconds), channels), 240);
      const timesMs = [0, 1].map(() => {
        const startedMs = performance.now();
        savedFrom(session, 240);
        return performance.now() - startedMs;
      });
      return Math.min(...timesMs);
    };
    const shortMs = analyzeMs(90, 1);
    const longMs = analyzeMs(360, 1);
    // Every 2.5 s, each run is long enough to be searched for beats: the per-segment cost.
    const searchedMs = analyzeMs(360, 2.5);
    console.info(
      `analyzeReading at 240 fps, NaN every 1 s: 90 s ${shortMs.toFixed(0)} ms, 360 s ${longMs.toFixed(0)} ms;` +
        ` NaN every 2.5 s: 360 s ${searchedMs.toFixed(0)} ms`,
    );
    expect(longMs / shortMs).toBeLessThan(10);
  });
});

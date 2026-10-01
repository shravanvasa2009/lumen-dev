import {
  buildTimebase,
  classifyBeats,
  detectBeats,
  DSP_CONFIG,
  fingerSignals,
  resampleCubic,
  type ClassifiedBeat,
  type RejectedSpan,
} from '../../src';
import { captureAt, morphologySegment, parkMillerUniforms, type SyntheticBeat } from '../synthetic';

export interface Draws {
  uniform(low: number, high: number): number;
  normal(): number;
}

// Deterministic draws from the shared Park–Miller stream, so every case reproduces from its seed. The
// first outputs are dropped: output k is 16807^k · seed mod (2³¹ − 1), so for consecutive seeds the first
// one is nearly the same (16807 · seed / (2³¹ − 1)) and would pin each case's first parameter.
const WARM_UP_DRAWS = 4;
export function draws(seed: number, count = 100_000): Draws {
  const uniforms = parkMillerUniforms(count + WARM_UP_DRAWS, seed);
  let next = WARM_UP_DRAWS;
  const take = () => {
    if (next >= uniforms.length) throw new RangeError(`seed ${seed}: more than ${count} draws`);
    return uniforms[next++]!;
  };
  return {
    uniform: (low, high) => low + (high - low) * take(),
    // Box–Muller; Park–Miller never returns 0, so the logarithm is finite.
    normal: () => Math.sqrt(-2 * Math.log(take())) * Math.cos(2 * Math.PI * take()),
  };
}

// One beat's pulse, in units of a normal beat's systolic height, against time from its systolic peak.
export type PulseShape = (fromPeakS: number) => number;

const gaussian = (tS: number, sigmaS: number) => Math.exp(-0.5 * (tS / sigmaS) ** 2);

// The fixture of test/synthetic.ts with free dicrotic parameters: a separate dicrotic wave.
export const twoGaussian =
  (dicroticRatio: number, delayS = 0.3, dicroticSigmaS = 0.08): PulseShape =>
  (tS) =>
    gaussian(tS, 0.06) + dicroticRatio * gaussian(tS - delayS, dicroticSigmaS);

// Systolic runoff (exponential decay after the peak) with a dicrotic hump riding on it, so the notch
// stays well above the diastolic foot, as in most adult finger PPG.
export const runoff =
  (decayS: number, humpRatio: number, delayS: number, humpSigmaS: number, riseSigmaS = 0.06): PulseShape =>
  (tS) =>
    (tS < 0 ? gaussian(tS, riseSigmaS) : Math.exp(-tS / decayS)) +
    humpRatio * gaussian(tS - delayS, humpSigmaS);

// Finger pulses spread over the four dicrotic-notch classes of Dawber, Thomas and McNamara (Angiology
// 1973;24:244-255, doi:10.1177/000331977302400407), from a clear notch (class 1) to none (class 4). The
// systolic-to-diastolic peak time spans 0.15-0.35 s, the range of the stiffness-index examples in
// Millasseau et al. (Clin Sci 2002;103:371-377, doi:10.1042/cs1030371): 147 ms at age 60, 270 ms at 45,
// 346 ms at 29. Other ranges are chosen to cover the classes, not fitted to recordings.
export function fingerPulseShape(random: Draws): PulseShape {
  return runoff(
    random.uniform(0.15, 0.35),
    random.uniform(0.1, 0.6),
    random.uniform(0.15, 0.35),
    random.uniform(0.03, 0.08),
    random.uniform(0.05, 0.08),
  );
}

// Diastolic to systolic peak ratio of a raw (unfiltered) pulse; 0 when no distinct diastolic peak follows
// a notch (Dawber classes 3 and 4).
export function diastolicPeakRatio(shape: PulseShape): number {
  let systolic = -Infinity;
  for (let tS = -0.05; tS <= 0.05; tS += 0.001) systolic = Math.max(systolic, shape(tS));
  let notchS: number | null = null;
  for (let tS = 0.02, previous = shape(0.01); tS < 0.7; tS += 0.001) {
    const value = shape(tS);
    if (value > previous) {
      notchS = tS;
      break;
    }
    previous = value;
  }
  if (notchS === null) return 0;
  let diastolic = -Infinity;
  for (let tS = notchS; tS < 0.7; tS += 0.001) diastolic = Math.max(diastolic, shape(tS));
  return diastolic / systolic;
}

// Physiological cap: the diastolic peak of raw finger PPG is 64 ± 3% of the systolic peak in healthy
// young men (Millasseau et al., Clin Sci 2002;103:371-377, doi:10.1042/cs1030371), so shapes above 0.75
// are drawn again.
export function physiologicalShape(random: Draws, draw: (random: Draws) => PulseShape): PulseShape {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const shape = draw(random);
    if (diastolicPeakRatio(shape) <= 0.75) return shape;
  }
  throw new RangeError('no pulse shape within the diastolic/systolic cap in 1000 draws');
}

// One breath cycle at 0.2–0.3 Hz (12–18 breaths/min at rest); +1 at mid-inspiration.
export type Breathing = (tS: number) => number;
export function breathing(random: Draws): Breathing {
  const hz = random.uniform(0.2, 0.3);
  const phase = random.uniform(0, 2 * Math.PI);
  return (tS) => Math.sin(2 * Math.PI * hz * tS + phase);
}

// Breathing modulates finger PPG: inspiration lowers the pulse height (by up to `depth`) and moves the
// baseline (respiratory-induced intensity variation, 0.2–0.6 × the pulse height); a slow drift adds
// 0.5–1.5 × the pulse height at 0.02–0.08 Hz. Units of the disturbance are red full scale.
export function withRespiration(
  random: Draws,
  pulse: (tS: number) => number,
  depth: number,
  breath: Breathing,
  perfusion = 0.01,
): { pulse: (tS: number) => number; disturbance: (tS: number) => number } {
  const wander = random.uniform(0.2, 0.6) * perfusion;
  const driftHz = random.uniform(0.02, 0.08);
  const driftPhase = random.uniform(0, 2 * Math.PI);
  const drift = random.uniform(0.5, 1.5) * perfusion;
  return {
    pulse: (tS) => pulse(tS) * (1 - depth * breath(tS)),
    disturbance: (tS) => wander * breath(tS) + drift * Math.sin(2 * Math.PI * driftHz * tS + driftPhase),
  };
}

export function pulseOf(beats: SyntheticBeat[], shape: PulseShape): (tS: number) => number {
  return (tS) => {
    let sum = 0;
    for (const { peakS, amplitude } of beats)
      if (Math.abs(tS - peakS) < 1.5) sum += amplitude * shape(tS - peakS);
    return sum;
  };
}

export interface CameraSpec {
  fps: number;
  seconds: number;
  seed: number;
  pulse: (tS: number) => number;
  perfusion?: number; // a normal beat's height as a fraction of full scale
  noise?: number; // per-frame noise SD, fraction of full scale
  redLevel?: (tS: number) => number; // mean red (DC); values pushed above 1 clip
  disturbance?: (tS: number) => number; // added to red, e.g. motion
  keepFrame?: (tS: number) => boolean; // false drops the frame
}

// Red channel of a covered fingertip: more blood absorbs more red, so the pulse lowers R (DSP-3).
export function cameraCapture(spec: CameraSpec) {
  const random = draws(spec.seed);
  const perfusion = spec.perfusion ?? 0.01;
  const noise = spec.noise ?? 0.0002;
  const offsets: number[] = [];
  for (let k = 0; k < Math.round(spec.fps * spec.seconds); k++) {
    // Frame-time jitter of ±1 ms, as phone timestamps show.
    const tS = k === 0 ? 0 : k / spec.fps + random.uniform(-0.001, 0.001);
    if (k === 0 || (spec.keepFrame?.(tS) ?? true)) offsets.push(tS);
  }
  return captureAt(offsets, (tS) => {
    const red =
      (spec.redLevel?.(tS) ?? 0.7) +
      (spec.disturbance?.(tS) ?? 0) -
      perfusion * spec.pulse(tS) +
      noise * random.normal();
    return { r: Math.min(1, Math.max(0, red)), g: 0.15, b: 0.05 };
  });
}

export interface Analysis {
  beats: ClassifiedBeat[];
  segments: [number, number][]; // start and end, seconds from capture start
}

// The app's beat path: timebase, −R, cubic resampling, morphology band, DSP-7/8 detection, DSP-9.
export function analyse(capture: ReturnType<typeof cameraCapture>, spans: RejectedSpan[]): Analysis {
  const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
  const timebase = buildTimebase(capture.samples, capture.stats);
  const ppg = fingerSignals(timebase).primary;
  const models = resampleCubic(timebase.tS, ppg, modelRateHz);
  const shapes = resampleCubic(timebase.tS, ppg, shapeRateHz);
  const analysis: Analysis = { beats: [], segments: [] };
  models.forEach((modelSegment) => {
    const startS = modelSegment.firstIndex / modelRateHz;
    const endS = (modelSegment.firstIndex + modelSegment.values.length - 1) / modelRateHz;
    // Under 2 s a segment cannot hold an Elgendi W2 window on each side of a beat.
    if (endS - startS < 2) return;
    const shapeSegment = shapes.find(
      ({ firstIndex, values }) =>
        firstIndex / shapeRateHz <= startS && (firstIndex + values.length - 1) / shapeRateHz >= endS,
    )!;
    const model = morphologySegment(modelSegment.values, modelRateHz, modelSegment.firstIndex);
    const shape = morphologySegment(shapeSegment.values, shapeRateHz, shapeSegment.firstIndex);
    analysis.beats.push(...classifyBeats(detectBeats(model, shape), shape, spans));
    analysis.segments.push([startS, endS]);
  });
  return analysis;
}

// The detection nearest each true beat, if one lies within the tolerance.
export function matchBeats(
  analysis: Analysis,
  truth: SyntheticBeat[],
  toleranceS = 0.06,
): (ClassifiedBeat | null)[] {
  return truth.map(({ peakS }) => {
    let best: ClassifiedBeat | null = null;
    for (const beat of analysis.beats)
      if (
        Math.abs(beat.peakS - peakS) <= toleranceS &&
        (!best || Math.abs(beat.peakS - peakS) < Math.abs(best.peakS - peakS))
      )
        best = beat;
    return best;
  });
}

// True beats that stay at least `marginS` away from segment edges and from every listed span.
export function wellInside(
  analysis: Analysis,
  truth: SyntheticBeat[],
  avoid: [number, number][],
  marginS: number,
) {
  return truth.filter(
    ({ peakS }) =>
      analysis.segments.some(([startS, endS]) => peakS - startS >= marginS && endS - peakS >= marginS) &&
      avoid.every(([startS, endS]) => peakS < startS - marginS || peakS > endS + marginS),
  );
}

// Sinus rhythm with small beat-to-beat variation (SD 3% of RR). With respiratory sinus arrhythmia,
// inspiration also shortens RR by up to `rsa`, in phase with the smaller pulses of withRespiration, so
// "early and small" sinus beats occur as they do in real (especially young) people.
export function sinusBeats(
  random: Draws,
  bpm: number,
  firstS: number,
  lastS: number,
  rsa?: { depth: number; breath: Breathing },
): SyntheticBeat[] {
  const beats: SyntheticBeat[] = [];
  for (let peakS = firstS; peakS < lastS;) {
    beats.push({ peakS, amplitude: 1 });
    const breathFactor = rsa ? 1 - rsa.depth * rsa.breath(peakS) : 1;
    peakS += (60 / bpm) * breathFactor * (1 + 0.03 * random.normal());
  }
  return beats;
}

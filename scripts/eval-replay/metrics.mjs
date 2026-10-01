import { alignIntervals } from './align.mjs';
import { mean, rmssd, subjectBootstrap } from './stats.mjs';

// DSP-B: RMSSD agreement is judged only on phones whose rear camera runs at 60 fps or faster.
const RMSSD_MIN_FPS = 60;
const RMSSD_TOLERANCE = 0.1;

const round = (value) => (value == null ? null : Math.round(value * 100) / 100);
const roundPair = (pair) => pair?.map(round) ?? null;
const distinct = (values) => new Set(values).size;
const subjectOf = (capture) => capture.meta.subject.code;
const isConclusive = (capture) =>
  capture.reading.inconclusive !== true && capture.reading.headlineKey !== 'result.inconclusive';

function hrError(capture) {
  const phoneHr = capture.reading.metrics?.hr?.value;
  if (!capture.polarRrMs?.length || phoneHr == null || !isConclusive(capture)) return null;
  return Math.abs(phoneHr - 60000 / mean(capture.polarRrMs));
}

function aligned(capture) {
  if (!capture.polarRrMs?.length || !capture.phoneRrMs?.length || !isConclusive(capture)) return null;
  return alignIntervals(capture.phoneRrMs, capture.polarRrMs);
}

function intervalError(capture) {
  const pair = aligned(capture);
  return pair && mean(pair.phone.map((value, i) => Math.abs(value - pair.polar[i])));
}

function summarize(captures, errorOf) {
  const rows = captures
    .map((capture) => ({ capture, value: errorOf(capture) }))
    .filter((row) => row.value != null);
  const { value, ci95 } = subjectBootstrap(
    rows.map((row) => ({ subject: subjectOf(row.capture), value: row.value })),
  );
  return { value, ci95, rows };
}

export function computeMetrics(captures, { commit, date }) {
  const hr = summarize(captures, hrError);
  const intervals = summarize(captures, intervalError);

  const rmssdRows = captures
    .filter((capture) => capture.meta.fps >= RMSSD_MIN_FPS)
    .map((capture) => ({ capture, pair: aligned(capture) }))
    .filter((row) => row.pair);
  const withinTolerance = rmssdRows.filter(({ pair }) => {
    const reference = rmssd(pair.polar);
    return Math.abs(rmssd(pair.phone) - reference) / reference <= RMSSD_TOLERANCE;
  });

  const resp = summarize(captures, (capture) => {
    const paced = capture.meta.labels?.pacedBrpm;
    const measured = capture.reading.metrics?.resp?.value;
    return paced == null || measured == null || !isConclusive(capture) ? null : Math.abs(measured - paced);
  });

  const artifacts = captures.filter((capture) => capture.meta.labels?.deliberateArtifact === true);
  const firstReadings = captures.filter((capture) => capture.meta.labels?.firstReading === true);
  // ML-5: a reading counts as Polar-confirmed sinus only when the strap was recording and the label says sinus.
  const sinus = captures.filter(
    (capture) =>
      capture.meta.labels?.rhythm === 'sinus' && capture.polarRrMs?.length && isConclusive(capture),
  );

  const tiers = [...new Set(captures.map((capture) => capture.meta.rating?.tier).filter(Boolean))].sort();
  const perTier = tiers.map((tier) => {
    const inTier = captures.filter((capture) => capture.meta.rating?.tier === tier);
    const hrErrors = inTier.map(hrError).filter((value) => value != null);
    const intervalErrors = inTier.map(intervalError).filter((value) => value != null);
    return {
      tier,
      phones: distinct(inTier.map((capture) => capture.meta.modelId)),
      hrMaeBpm: round(hrErrors.length ? mean(hrErrors) : null),
      intervalMaeMs: round(intervalErrors.length ? mean(intervalErrors) : null),
    };
  });

  return {
    commit,
    date,
    polarPairedCaptures: captures.filter((capture) => capture.polarRrMs?.length).length,
    hr: {
      maeBpm: round(hr.value),
      ci95: roundPair(hr.ci95),
      people: distinct(hr.rows.map((row) => subjectOf(row.capture))),
      readings: hr.rows.length,
      phones: distinct(hr.rows.map((row) => row.capture.meta.modelId)),
    },
    intervals: { maeMs: round(intervals.value), ci95: roundPair(intervals.ci95) },
    rmssd: {
      withinPct: round(rmssdRows.length ? (100 * withinTolerance.length) / rmssdRows.length : null),
      people: distinct(rmssdRows.map((row) => subjectOf(row.capture))),
    },
    resp: { maeBrpm: round(resp.value), people: distinct(resp.rows.map((row) => subjectOf(row.capture))) },
    artifactCaptures: {
      total: artifacts.length,
      rejectedOrInconclusive: artifacts.filter((capture) => !isConclusive(capture)).length,
    },
    ux1: { firstReadings: firstReadings.length, conclusive: firstReadings.filter(isConclusive).length },
    ml5: {
      sinusReadings: sinus.length,
      falseIrregular: sinus.filter((capture) => capture.reading.metrics?.rhythm?.flag != null).length,
    },
    perTier,
    recompute: { agent: null, matches: null },
  };
}

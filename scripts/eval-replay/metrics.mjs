import { alignIntervals } from './align.mjs';
import { mean, median, rmssd, subjectBootstrap } from './stats.mjs';

// Which readings count: only conclusive ones feed error metrics; DSP-A uses resting sessions only;
// strap intervals outside 30–200 bpm are strap artifacts and are never a reference.
// DSP-B: RMSSD agreement is judged only on phones whose rear camera runs at 60 fps or faster.
const RMSSD_MIN_FPS = 60;
const RMSSD_TOLERANCE = 0.1;
// Strap intervals outside 30–200 bpm are strap artifacts, never a reference.
const POLAR_MIN_MS = 300;
const POLAR_MAX_MS = 2000;

const round = (value) => (value == null ? null : Math.round(value * 100) / 100);
const roundPair = (pair) => pair?.map(round) ?? null;
const distinct = (values) => new Set(values).size;
const subjectOf = (capture) => capture.meta.subject.code;
const polarUsable = (rr) => rr >= POLAR_MIN_MS && rr <= POLAR_MAX_MS;
// result.uncertain still shows its numbers to the user, so it counts as conclusive.
const isConclusive = (capture) =>
  capture.reading.inconclusive !== true && capture.reading.headlineKey !== 'result.inconclusive';
const hasPolar = (capture) => capture.polarRrMs?.some(polarUsable);
// DSP-A is "at rest": no deliberate artifacts, no paced breathing, no standing test.
const isRest = (capture) =>
  capture.meta.labels?.deliberateArtifact !== true &&
  capture.meta.labels?.pacedBrpm == null &&
  capture.meta.mode !== 'standing';

function hrError(capture) {
  const phoneHr = capture.reading.metrics?.hr?.value;
  if (!hasPolar(capture) || phoneHr == null || !isConclusive(capture) || !isRest(capture)) return null;
  return Math.abs(phoneHr - 60000 / mean(capture.polarRrMs.filter(polarUsable)));
}

// Sequence alignment searches only ±10 beats, so when the strap data starts later in the reading (the
// longest stretch after a dropout), alignment starts at the phone beat the shared clock puts there. The margin
// covers the strap's notification delay (up to one RR) with room to spare.
const START_MARGIN_BEATS = 5;

function phoneBeatsBeforeStrap(capture) {
  if (capture.polarStartNs == null) return 0;
  const firstAfter = capture.phone.findIndex((beat) => beat.endNs > capture.polarStartNs);
  return firstAfter === -1 ? 0 : Math.max(0, firstAfter - START_MARGIN_BEATS);
}

function alignmentOf(capture) {
  if (!hasPolar(capture) || !capture.phone.length || !isConclusive(capture)) return null;
  const skip = phoneBeatsBeforeStrap(capture);
  const alignment = alignIntervals(
    capture.phone.slice(skip).map((beat) => beat.ibiMs),
    capture.polarRrMs,
    (p, q) => capture.phone[p + skip].accepted && polarUsable(capture.polarRrMs[q]),
  );
  return alignment && { ...alignment, pairs: alignment.pairs.map(([p, q]) => [p + skip, q]) };
}

// Only pairs where the phone kept the beat and the strap interval is in range are compared.
function comparedPairs(capture, alignment) {
  return alignment.pairs.filter(([p, q]) => capture.phone[p].accepted && polarUsable(capture.polarRrMs[q]));
}

function intervalError(capture, alignment) {
  const pairs = alignment && comparedPairs(capture, alignment);
  if (!pairs?.length) return null;
  return mean(pairs.map(([p, q]) => Math.abs(capture.phone[p].ibiMs - capture.polarRrMs[q])));
}

// The app's own RMSSD against the strap's RMSSD over the matched segment (DSP-B checks what the card shows).
function rmssdRelativeError(capture, alignment) {
  const shown = capture.reading.metrics?.rmssd?.value;
  if (shown == null || !alignment?.pairs.length) return null;
  const segment = capture.polarRrMs.slice(alignment.pairs[0][1], alignment.pairs.at(-1)[1] + 1);
  const reference = rmssd(segment, segment.map(polarUsable));
  if (!reference) return null;
  return Math.abs(shown - reference) / reference;
}

function summarize(rows) {
  const kept = rows.filter((row) => row.value != null);
  const { value, ci95 } = subjectBootstrap(
    kept.map((row) => ({ subject: subjectOf(row.capture), value: row.value })),
  );
  return { value, ci95, rows: kept };
}

export function computeMetrics(captures, { commit, date }, log = () => {}) {
  const aligned = captures.map((capture) => {
    const alignment = alignmentOf(capture);
    if (alignment)
      log(`${capture.folder}: lag ${alignment.lag} beats, r ${alignment.correlation.toFixed(3)}`);
    else if (hasPolar(capture) && isConclusive(capture))
      log(`${capture.folder}: phone and strap did not align`);
    return { capture, alignment };
  });

  const hr = summarize(captures.map((capture) => ({ capture, value: hrError(capture) })));
  const intervals = summarize(
    aligned.map(({ capture, alignment }) => ({ capture, value: intervalError(capture, alignment) })),
  );
  const rmssdRows = aligned
    .filter(({ capture }) => capture.meta.fps >= RMSSD_MIN_FPS)
    .map(({ capture, alignment }) => ({ capture, error: rmssdRelativeError(capture, alignment) }))
    .filter((row) => row.error != null);
  const resp = summarize(
    captures.map((capture) => {
      const paced = capture.meta.labels?.pacedBrpm;
      const measured = capture.reading.metrics?.resp?.value;
      const usable = paced != null && measured != null && isConclusive(capture);
      return { capture, value: usable ? Math.abs(measured - paced) : null };
    }),
  );

  const artifacts = captures.filter((capture) => capture.meta.labels?.deliberateArtifact === true);
  const firstReadings = captures.filter((capture) => capture.meta.labels?.firstReading === true);
  const sinus = captures.filter(
    (capture) => capture.meta.labels?.rhythm === 'sinus' && hasPolar(capture) && isConclusive(capture),
  );

  const tiers = [...new Set(captures.map((capture) => capture.meta.rating?.tier).filter(Boolean))].sort();
  const perTier = tiers.map((tier) => {
    const inTier = aligned.filter(({ capture }) => capture.meta.rating?.tier === tier);
    const tierHr = summarize(inTier.map(({ capture }) => ({ capture, value: hrError(capture) })));
    const tierIntervals = summarize(
      inTier.map(({ capture, alignment }) => ({ capture, value: intervalError(capture, alignment) })),
    );
    return {
      tier,
      phones: distinct(inTier.map(({ capture }) => capture.meta.modelId)),
      hrMaeBpm: round(tierHr.value),
      intervalMaeMs: round(tierIntervals.value),
    };
  });

  return {
    commit,
    date,
    polarPairedCaptures: captures.filter(hasPolar).length,
    hr: {
      maeBpm: round(hr.value),
      ci95: roundPair(hr.ci95),
      people: distinct(hr.rows.map((row) => subjectOf(row.capture))),
      readings: hr.rows.length,
      phones: distinct(hr.rows.map((row) => row.capture.meta.modelId)),
    },
    intervals: { maeMs: round(intervals.value), ci95: roundPair(intervals.ci95) },
    rmssd: {
      withinPct: round(
        rmssdRows.length
          ? (100 * rmssdRows.filter((row) => row.error <= RMSSD_TOLERANCE).length) / rmssdRows.length
          : null,
      ),
      // DSP-B's pass rule uses the median across readings (ADR 0044).
      medianErrorPct: round(rmssdRows.length ? 100 * median(rmssdRows.map((row) => row.error)) : null),
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

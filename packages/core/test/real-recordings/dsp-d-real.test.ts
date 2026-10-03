import { captureAt, regularOffsets } from '../synthetic';
import { analyse, type Analysis } from '../synthetic-suite/frames';
import { butPpgDir, readButPpg, type ButPpgRecord } from './butppg';

// DSP-D on real fingertip recordings (owner decision H-021, option A): extra detections kept < 5% of
// beats and real beats removed ≤ 1%. Protocol and subject split from ADR 0025 ("Rule (e) rework on BUT
// PPG"): DSP-9 was tuned on the tuning half, so only the report half is asserted. Subjects 100–111 (the
// older file layout) were never in that split; they are printed, not asserted (owner H-038 A).
const TUNING_SUBJECTS = new Set(
  '113 114 117 118 119 121 126 127 128 129 135 137 138 141 142 143 144 145 146'.split(' '),
);
const REPORT_SUBJECTS = new Set(
  '112 115 120 122 123 124 125 130 131 132 133 134 136 139 140 147 148 149'.split(' '),
);
const MAX_REMOVED = 0.01;
const MAX_EXTRAS_KEPT = 0.05;

// The PPG has no frame timestamps, so ECG time is mapped to PPG time by a per-record scale (camera
// clock vs ECG clock) and lag (pulse transit plus start offset), fitted on a grid.
const SCALES = Array.from({ length: 25 }, (_, i) => 0.97 + 0.0025 * i);
const LAGS_S = Array.from({ length: 151 }, (_, i) => -0.5 + 0.01 * i);
const MATCH_S = 0.1;
const EDGE_S = 1;
// Owner decision H-028 option A (ADR 0025 definition): an extra detection is an unmatched candidate
// 0.15–0.35 s after a matched one, where a dicrotic double sits. It is timed from the matched candidate, not
// the mapped QRS, so the per-record alignment error does not move it. B and C are printed for the record.
const DICROTIC_AFTER_S: [number, number] = [0.15, 0.35];

const CASE_TIMEOUT_MS = 600_000;

interface Counts {
  records: number;
  referenceBeats: number;
  missed: number;
  removed: number; // reference beats whose nearest candidate within 0.1 s is not-a-beat
  extras: number; // A: unmatched candidates 0.15–0.35 s after a matched candidate
  extrasKept: number; // A: extras not classed not-a-beat (asserted)
  netExtrasKept: number; // B: per record, kept candidates minus reference beats, floored at 0
  anyDelayExtrasKept: number; // C: kept candidates more than 0.1 s from every mapped QRS
}
const emptyCounts = (): Counts => ({
  records: 0,
  referenceBeats: 0,
  missed: 0,
  removed: 0,
  extras: 0,
  extrasKept: 0,
  netExtrasKept: 0,
  anyDelayExtrasKept: 0,
});

function analyseRecord(record: ButPpgRecord): Analysis {
  const seconds = record.red.length / record.rateHz;
  const capture = captureAt(regularOffsets(record.rateHz, seconds), (tS) => ({
    r: record.red[Math.round(tS * record.rateHz)]!,
    g: 0,
    b: 0,
  }));
  return analyse(capture, []);
}

// Most QRS (inside the edge margins) with a candidate within 0.1 s; ties go to the smaller total error.
function mapQrs(qrsS: number[], peaksS: number[], seconds: number): number[] {
  let best = { matched: -1, errorS: Infinity, scale: 1, lagS: 0 };
  for (const scale of SCALES)
    for (const lagS of LAGS_S) {
      let matched = 0;
      let errorS = 0;
      for (const qrs of qrsS) {
        const tS = qrs * scale + lagS;
        if (tS < EDGE_S || tS > seconds - EDGE_S) continue;
        const distanceS = Math.min(...peaksS.map((peakS) => Math.abs(peakS - tS)));
        if (distanceS > MATCH_S) continue;
        matched++;
        errorS += distanceS;
      }
      if (matched > best.matched || (matched === best.matched && errorS < best.errorS))
        best = { matched, errorS, scale, lagS };
    }
  return qrsS.map((qrs) => qrs * best.scale + best.lagS);
}

function countRecord(record: ButPpgRecord): Counts {
  const counts = emptyCounts();
  const seconds = record.red.length / record.rateHz;
  const inside = (tS: number) => tS >= EDGE_S && tS <= seconds - EDGE_S;
  const { beats } = analyseRecord(record);
  const referenceS = mapQrs(
    record.qrsS,
    beats.map(({ peakS }) => peakS),
    seconds,
  );
  counts.records++;
  for (const tS of referenceS.filter(inside)) {
    counts.referenceBeats++;
    const nearest = beats.reduce<(typeof beats)[number] | null>(
      (best, beat) =>
        Math.abs(beat.peakS - tS) <= MATCH_S &&
        (!best || Math.abs(beat.peakS - tS) < Math.abs(best.peakS - tS))
          ? beat
          : best,
      null,
    );
    if (!nearest) counts.missed++;
    else if (nearest.beatClass === 'not-a-beat') counts.removed++;
  }
  const [afterMinS, afterMaxS] = DICROTIC_AFTER_S;
  const isMatched = (peakS: number) => referenceS.some((tS) => Math.abs(peakS - tS) <= MATCH_S);
  const matchedPeaksS = beats.map(({ peakS }) => peakS).filter(isMatched);
  let keptInside = 0;
  for (const beat of beats) {
    if (!inside(beat.peakS)) continue;
    const kept = beat.beatClass !== 'not-a-beat';
    if (kept) keptInside++;
    if (isMatched(beat.peakS)) continue;
    if (kept) counts.anyDelayExtrasKept++;
    const afterMatched = matchedPeaksS.some(
      (peakS) => beat.peakS - peakS >= afterMinS && beat.peakS - peakS <= afterMaxS,
    );
    if (!afterMatched) continue;
    counts.extras++;
    if (kept) counts.extrasKept++;
  }
  counts.netExtrasKept += Math.max(0, keptInside - referenceS.filter(inside).length);
  return counts;
}

function addCounts(into: Counts, from: Counts) {
  for (const key of Object.keys(from) as (keyof Counts)[]) into[key] += from[key];
}

const percent = (part: number, whole: number) => `${((100 * part) / whole).toFixed(2)}%`;
const describeCounts = (label: string, counts: Counts) =>
  `${label}: ${counts.records} records, ${counts.referenceBeats} reference beats; ` +
  `real beats removed ${percent(counts.removed, counts.referenceBeats)} (${counts.removed}), ` +
  `extras kept (A, 0.15–0.35 s after a matched beat) ${percent(counts.extrasKept, counts.referenceBeats)} ` +
  `(${counts.extrasKept} of ${counts.extras}), net per record (B) ` +
  `${percent(counts.netExtrasKept, counts.referenceBeats)}, any delay (C) ` +
  `${percent(counts.anyDelayExtrasKept, counts.referenceBeats)}, ` +
  `missed ${percent(counts.missed, counts.referenceBeats)} (${counts.missed})`;

describe('DSP-D on BUT PPG 2.0.0 (quality 1, no motion; ADR 0025 report half asserted)', () => {
  const groups = {
    report: emptyCounts(),
    reportFinger: emptyCounts(),
    reportEar: emptyCounts(),
    tuning: emptyCounts(),
    outsideSplit: emptyCounts(),
  };
  const reportSubjectsRead = new Set<string>();

  beforeAll(() => {
    const records = readButPpg(butPpgDir(), ({ quality, motion }) => quality === 1 && motion === 0);
    for (const record of records) {
      if (REPORT_SUBJECTS.has(record.subject)) {
        reportSubjectsRead.add(record.subject);
        const counts = countRecord(record);
        addCounts(groups.report, counts);
        addCounts(record.site === 1 ? groups.reportFinger : groups.reportEar, counts);
      } else
        addCounts(
          TUNING_SUBJECTS.has(record.subject) ? groups.tuning : groups.outsideSplit,
          countRecord(record),
        );
    }
    console.info(
      [
        'DSP-D on BUT PPG (measured; denominators are reference beats ≥ 1 s from either end)',
        describeCounts('Report half (asserted)', groups.report),
        describeCounts('  finger (site 1)', groups.reportFinger),
        describeCounts('  ear (site 0)', groups.reportEar),
        describeCounts('Tuning half (DSP-9 tuned here; not asserted)', groups.tuning),
        describeCounts('Subjects outside the ADR 0025 split (not asserted)', groups.outsideSplit),
      ].join('\n'),
    );
  }, CASE_TIMEOUT_MS);

  it('covers every report-half subject', () => {
    expect([...reportSubjectsRead].sort()).toEqual([...REPORT_SUBJECTS].sort());
  });

  it('removes no more than 1% of real beats', () => {
    expect(groups.report.removed / groups.report.referenceBeats).toBeLessThanOrEqual(MAX_REMOVED);
  });

  it('keeps dicrotic extra detections (H-028 option A) below 5% of beats', () => {
    expect(groups.report.extrasKept / groups.report.referenceBeats).toBeLessThan(MAX_EXTRAS_KEPT);
  });
});

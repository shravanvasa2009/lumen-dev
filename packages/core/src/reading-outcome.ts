import { DSP_CONFIG } from './config';
import type { RejectedSpan, RejectionReason } from './live-session';
import type { ReadingAnalysis } from './reading';
import type { LostSeconds } from './results';

// Appendix B lostSeconds keys. §12's Inconclusive rows are movement = motion, pressure, light = coverage.
export type LostCause = keyof LostSeconds;

// Listed in this order when both hold.
export type InconclusiveReason = 'tooFewCleanSeconds' | 'noHeartRate';

export interface InconclusiveOutcome {
  kind: 'inconclusive';
  reasons: InconclusiveReason[];
  cleanSeconds: number;
  neededCleanSeconds: number;
  // Each lost second counted once, under its first cause in COACHING_ORDER, so cleanSeconds, these, and
  // otherLostSeconds add up to the capture's length. The Results JSON's lostSeconds counts each cause on
  // its own instead.
  lostSeconds: LostSeconds;
  otherLostSeconds: number; // SQI-rejected and flat windows, and the 1 s after an exposure change
  causes: LostCause[]; // causes that lost time, most seconds first: the first ones pick §12's two tips
}

export type ReadingOutcome = { kind: 'reading' } | InconclusiveOutcome;

// §12 Capture: one coaching line at a time, finger contact → motion → pressure → cold hands.
const COACHING_ORDER: readonly LostCause[] = ['coverage', 'motion', 'pressure', 'coldHands'];

// Clipping is the saturated DC of pressing too hard (§7), as in analyzeReading's lostSeconds. Quality and
// exposure spans have no §7 coaching cause.
const CAUSE: Record<RejectionReason, LostCause | null> = {
  coverage: 'coverage',
  motion: 'motion',
  pressure: 'pressure',
  clipping: 'pressure',
  coldHands: 'coldHands',
  quality: null,
  exposure: null,
};

function lostByCause(spans: RejectedSpan[], durationS: number) {
  const ranked = spans
    .map((span) => {
      const cause = CAUSE[span.reason];
      return {
        fromS: Math.max(span.startS, 0),
        toS: Math.min(span.endS, durationS),
        rank: cause === null ? COACHING_ORDER.length : COACHING_ORDER.indexOf(cause),
      };
    })
    .filter((span) => span.toS > span.fromS);
  const edges = [...new Set(ranked.flatMap((span) => [span.fromS, span.toS]))].sort((x, y) => x - y);
  const lostSeconds: LostSeconds = { motion: 0, pressure: 0, coverage: 0, coldHands: 0 };
  let otherLostSeconds = 0;
  for (let i = 1; i < edges.length; i++) {
    const fromS = edges[i - 1]!;
    const toS = edges[i]!;
    let rank = Infinity;
    for (const span of ranked) if (span.fromS <= fromS && span.toS >= toS) rank = Math.min(rank, span.rank);
    if (rank === Infinity) continue;
    const cause = COACHING_ORDER[rank];
    if (cause) lostSeconds[cause] += toS - fromS;
    else otherLostSeconds += toS - fromS;
  }
  return { lostSeconds, otherLostSeconds };
}

/** Spec 07: whether a capture may be saved as a reading, or ends inconclusive (§12 screen 19). */
export function readingOutcome(analysis: ReadingAnalysis): ReadingOutcome {
  const { mode } = analysis.context;
  const targets: Record<string, number> = DSP_CONFIG.rules.modeMinCleanS;
  if (!Object.hasOwn(targets, mode)) throw new RangeError(`mode ${mode} has no clean-seconds target`);
  const neededCleanSeconds = targets[mode]!;

  const reasons: InconclusiveReason[] = [];
  if (analysis.cleanSeconds < neededCleanSeconds) reasons.push('tooFewCleanSeconds');
  if (analysis.heartRateBpm === null) reasons.push('noHeartRate');
  if (reasons.length === 0) return { kind: 'reading' };

  const { lostSeconds, otherLostSeconds } = lostByCause(analysis.rejectedSpans, analysis.durationS);
  const causes = COACHING_ORDER.filter((cause) => lostSeconds[cause] > 0).sort(
    (x, y) => lostSeconds[y] - lostSeconds[x],
  );
  return {
    kind: 'inconclusive',
    reasons,
    cleanSeconds: analysis.cleanSeconds,
    neededCleanSeconds,
    lostSeconds,
    otherLostSeconds,
    causes,
  };
}

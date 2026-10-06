import type { ReadingAnalysis } from './reading';
import { hrSummary } from './reading-metrics';
import type { ReadingRhythm } from './results';
import { shapeFeatures } from './shape-features';

// §11.4 inputs in the model's shapes: beat [1, 1, 256], shapeFeatures [1, 12], hrSummary [1, 4]. A null
// value gets the model's training median at inference; core never fills one.
export interface DiabetesModelInput {
  beat: Float64Array;
  shapeFeatures: (number | null)[];
  hrSummary: (number | null)[];
}

// Who may see a diabetes result (Full Scan, Full tier, rules.diabetesMinCleanS) is buildReadingResult's
// rule; this only builds the inputs. HR and HRV summarise the whole reading, as the displayed values do;
// with one gap-free segment, which is what training sees, that is the segment the beat comes from.
/** ML-6: diabetes-net's inputs from a reading and its readingRhythm; null with no DSP-14 beat. */
export function diabetesModelInput(
  analysis: ReadingAnalysis,
  rhythm: ReadingRhythm | null,
): DiabetesModelInput | null {
  // ADR 0104: below DSP-14's floors the lower-quality beat stands in; buildReadingResult tags the result.
  const shape = analysis.pulseShape ?? analysis.lowQuality.pulseShape;
  if (!shape) return null;
  return {
    beat: shape.beat,
    shapeFeatures: shapeFeatures(shape),
    hrSummary: hrSummary(analysis.segments, rhythm, analysis.context.captureFps, analysis.cleanSeconds),
  };
}

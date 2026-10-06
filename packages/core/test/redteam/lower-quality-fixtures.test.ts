import {
  analyzeReading,
  breathingEstimates,
  lowQualityEnsembleBeat,
  lowQualityHeartRate,
  lowQualityRmssd,
  readingWideWindow,
  rhythmFeatureVector,
  rhythmModelRows,
  rhythmV2Features,
  type BeatClass,
  type MeasuredBeat,
} from '../../src';
import parityFixture from './fixtures/lower-quality-parity.json';
import rowsFixture from './fixtures/lower-quality-rhythm-rows.json';
import { parityInput, parityMorphology, rhythmAttacks } from './lower-quality-battery';

// The fixtures ml/tests/redteam/test_redteam_lower_quality.py reads must be what core makes from
// lower-quality-battery.ts today: the parity inputs and TypeScript outputs (§10.2), and the rhythm model rows
// of the Quick, sub-60 s, and few-second captures it scores with the shipped models.

describe('red team ADR 0104: the parity fixture is core’s output on lower-quality-battery inputs', () => {
  it.each(parityFixture.cases.map((entry) => [entry.input.seed, entry]))('seed %i', (seed, entry) => {
    const input = parityInput(seed as number);
    expect(JSON.parse(JSON.stringify(input))).toEqual(entry.input);
    const segments: MeasuredBeat[][] = input.segments.map((segment) =>
      segment.map(([peakS, beatClass, longPause, amplitude, intensity, dc]) => ({
        peakS,
        onsetS: peakS - 0.1,
        beatClass: beatClass as BeatClass,
        longPause,
        amplitude,
        intensity,
        dc,
      })),
    );
    const rmssd = lowQualityRmssd(segments);
    const window = readingWideWindow(input.intervalsS, input.spansArtifact, input.atypicalBeats);
    const shape = lowQualityEnsembleBeat(
      parityMorphology(input.morphologyPhases),
      input.onsets,
      input.normal,
    );
    const beat = shape ? Array.from(shape.beat) : [];
    expect({
      heartRateBpm: lowQualityHeartRate(segments),
      rmssd: rmssd && [rmssd.rmssdMs, rmssd.nnIntervals],
      breathing: breathingEstimates(segments),
      window: window && [window.startInterval, ...rhythmFeatureVector(window), ...rhythmV2Features(window)],
      shape: shape && {
        beatEvery16: beat.filter((_, k) => k % 16 === 0),
        beatSum: beat.reduce((total, value) => total + value, 0),
        beatsUsed: shape.beatsUsed,
        waves: shape.waves,
      },
    }).toEqual(JSON.parse(JSON.stringify(entry.expected)));
  });
});

describe('red team ADR 0104: the rhythm-row fixture is core’s rows for the rhythm attacks', () => {
  const attacks = rhythmAttacks();
  it('has one entry per attack, in order', () => {
    expect(rowsFixture.cases.map((entry) => entry.name)).toEqual(attacks.map((attack) => attack.name));
  });
  it.each(attacks.map((attack, i) => [attack.name, attack, rowsFixture.cases[i]!] as const))(
    '%s',
    (_, attack, entry) => {
      const analysis = analyzeReading(attack.build(), attack.context);
      expect(analysis.rhythmFeatures.length > 0).toBe(entry.standardRows);
      const rows = rhythmModelRows(analysis);
      expect(rows.length).toBe(entry.rows.length);
      rows.forEach((row, r) => row.forEach((value, f) => expect(value).toBeCloseTo(entry.rows[r]![f]!, 12)));
    },
  );
});

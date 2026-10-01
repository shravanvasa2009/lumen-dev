import {
  buildTimebase,
  butterBandpass,
  butterLowpass,
  CausalFilter,
  dcLevel,
  DSP_CONFIG,
  filterZeroPhase,
  fingerSignals,
  resampleCubic,
  type FrameStat,
  type Sample,
} from '../src';
import filtersGolden from './golden/filters.json';
import resampleGolden from './golden/resample.json';
import timebaseGolden from './golden/timebase.json';

// §10.2 parity with ml/lumen_dsp (python -m lumen_dsp.golden). Filters must match within 1e-6 (DSP-C).
const FILTER_TOLERANCE = 1e-6;
// The two splines solve the same natural-spline system by different routes (scipy: banded solve for
// slopes; core: Thomas algorithm for second derivatives), so values agree to rounding: observed 3.3e-16 on
// values near 0.6. 1e-12 leaves room for other machines and still catches any change of method.
const RESAMPLE_TOLERANCE = 1e-12;

function maxAbsDifference(actual: ArrayLike<number>, expected: number[]): number {
  expect(actual).toHaveLength(expected.length);
  return expected.reduce((worst, value, i) => Math.max(worst, Math.abs(actual[i]! - value)), 0);
}

const { samples: sampleColumns, stats: statColumns, expected } = timebaseGolden;
const samples: Sample[] = sampleColumns.tNs.map((tNs, i) => ({
  tNs,
  r: sampleColumns.r[i]!,
  g: sampleColumns.g[i]!,
  b: sampleColumns.b[i]!,
}));
const stats: FrameStat[] = statColumns.tNs.map((tNs, i) => ({
  tNs,
  spatialStdR: statColumns.spatialStdR[i]!,
  clipFrac: statColumns.clipFrac[i]!,
  exposureNs: statColumns.exposureNs[i]!,
}));
const timebase = buildTimebase(samples, stats);
const { primary, secondary } = fingerSignals(timebase);

describe('DSP-C golden parity: DSP-1 timebase and DSP-3 signals', () => {
  it('matches seconds, median interval, and dropped-frame gaps exactly (same IEEE operations)', () => {
    expect(timebase.startNs).toBe(expected.startNs);
    expect(Array.from(timebase.tS)).toEqual(expected.tS);
    expect(timebase.medianFrameIntervalS).toBe(expected.medianFrameIntervalS);
    expect(timebase.droppedGapStarts).toEqual(expected.droppedGapStarts);
  });

  it('matches −R and −G exactly', () => {
    expect(Array.from(primary)).toEqual(expected.primary);
    expect(Array.from(secondary)).toEqual(expected.secondary);
  });
});

describe('DSP-C golden parity: DSP-2 resampling', () => {
  it.each(resampleGolden.rates)('matches segments and values at $rateHz Hz', ({ rateHz, segments }) => {
    const resampled = resampleCubic(timebase.tS, primary, rateHz);
    expect(resampled.map((segment) => segment.firstIndex)).toEqual(
      segments.map((segment) => segment.firstIndex),
    );
    resampled.forEach((segment, i) => {
      expect(maxAbsDifference(segment.values, segments[i]!.values)).toBeLessThan(RESAMPLE_TOLERANCE);
    });
  });
});

// Filter inputs are the Python resampled segments, so these checks isolate the filters.
function goldenSegment(rateHz: number, firstIndex: number): number[] {
  const rate = resampleGolden.rates.find((entry) => entry.rateHz === rateHz)!;
  return rate.segments.find((segment) => segment.firstIndex === firstIndex)!.values;
}

describe('DSP-C golden parity: DSP-6 filters', () => {
  it.each(filtersGolden.bandPass)(
    '$band band (N = $order) at $rateHz Hz: sections, zero-phase, and causal output',
    ({ band, order, bandHz, rateHz, firstIndex, sos, zeroPhase, causal }) => {
      const { hrOrder, hrBandHz, morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
      // Fails if the config changed without regenerating the golden vectors.
      expect([order, bandHz]).toEqual(
        band === 'hr' ? [hrOrder, hrBandHz] : [morphologyOrder, morphologyBandHz],
      );
      const designed = butterBandpass(order, bandHz[0]!, bandHz[1]!, rateHz);
      expect(maxAbsDifference(designed.flat(), sos.flat())).toBeLessThan(FILTER_TOLERANCE);
      const input = goldenSegment(rateHz, firstIndex);
      expect(maxAbsDifference(filterZeroPhase(designed, input), zeroPhase)).toBeLessThan(FILTER_TOLERANCE);
      expect(maxAbsDifference(new CausalFilter(designed).filter(input), causal)).toBeLessThan(
        FILTER_TOLERANCE,
      );
    },
  );

  it.each(filtersGolden.dcLevel)(
    'DSP-3 DC level at $rateHz Hz',
    ({ rateHz, firstIndex, sos, dcLevel: expectedDc }) => {
      const { dcOrder, dcCutoffHz } = DSP_CONFIG.dsp3;
      const designed = butterLowpass(dcOrder, dcCutoffHz, rateHz);
      expect(maxAbsDifference(designed.flat(), sos.flat())).toBeLessThan(FILTER_TOLERANCE);
      const red = resampleCubic(timebase.tS, timebase.r, rateHz).find(
        (segment) => segment.firstIndex === firstIndex,
      )!;
      expect(maxAbsDifference(dcLevel(red.values, rateHz), expectedDc)).toBeLessThan(FILTER_TOLERANCE);
    },
  );
});

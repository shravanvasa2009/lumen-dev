import { readRhythmFigures } from './rhythmEvidence';

function fileWith(rhythm: unknown) {
  return { commit: null, date: null, metrics: { rhythm } };
}

describe('readRhythmFigures', () => {
  it.each([
    ['no file', undefined],
    ['an empty file', {}],
    ['no rhythm metric', { metrics: {} }],
    ['a rhythm metric without the figures', fileWith({ label: 'experimental', passed: false })],
    ['null figures', fileWith({ falseAfRatePrematureReadings: null, readingAbstainRate: null })],
    [
      'figures that are not shares of readings',
      fileWith({ falseAfRatePrematureReadings: 30, readingAbstainRate: '0.1' }),
    ],
    ['an estimate that is missing', fileWith({ falseAfRatePrematureReadings: { ci95: [0.1, 0.2] } })],
  ])('%s reads as untested', (_name, file) => {
    expect(readRhythmFigures(file)).toEqual({ falseAfRate: null, readingAbstainRate: null });
  });

  it('reads a bare rate and an estimate with its interval', () => {
    expect(
      readRhythmFigures(
        fileWith({
          falseAfRatePrematureReadings: { estimate: 0.25, ci95: [0.1, 0.5] },
          readingAbstainRate: 0.08,
        }),
      ),
    ).toEqual({ falseAfRate: 0.25, readingAbstainRate: 0.08 });
  });

  it('reads one figure when the other is absent', () => {
    expect(readRhythmFigures(fileWith({ falseAfRatePrematureReadings: 0.4 }))).toEqual({
      falseAfRate: 0.4,
      readingAbstainRate: null,
    });
  });
});

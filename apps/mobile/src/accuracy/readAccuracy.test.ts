import { countChecked, readAccuracy, readEvidenceDate } from './readAccuracy';

function fileWith(metrics: Record<string, unknown>, date: unknown = null) {
  return { commit: null, date, metrics };
}

describe('readAccuracy', () => {
  it.each([
    ['no file', undefined],
    ['an empty file', {}],
    [
      'the seed shape with every number null',
      fileWith({ hr: { label: 'experimental', maeBpm: null, passed: false } }),
    ],
  ])('%s: nothing is measured and no figure is read', (_name, file) => {
    for (const figures of Object.values(readAccuracy(file))) {
      expect(figures).toMatchObject({ measured: false, error: null, sensitivity: null, people: null });
    }
  });

  it('reads the figures of a passed metric', () => {
    const { hr, rhythm } = readAccuracy(
      fileWith({
        hr: {
          label: 'checked',
          passed: true,
          reference: 'Polar H10',
          maeBpm: 1.6,
          ci95: [1.2, 2.1],
          people: 12,
          phones: 5,
        },
        rhythm: {
          label: 'public-data',
          passed: true,
          dataset: 'MIMIC PERform AF',
          subjects: 35,
          sensitivity: 0.89,
        },
      }),
    );
    expect(hr).toMatchObject({
      measured: true,
      source: 'Polar H10',
      error: 1.6,
      ci95: [1.2, 2.1],
      people: 12,
      phones: 5,
    });
    expect(rhythm).toMatchObject({
      measured: true,
      source: 'MIMIC PERform AF',
      people: 35,
      sensitivity: 0.89,
      specificity: null,
    });
  });

  it('treats figures of the wrong shape or range as untested', () => {
    const { hr, rhythm, hrv } = readAccuracy(
      fileWith({
        hr: { label: 'checked', passed: true, maeBpm: '1.6', ci95: [1.2], people: 12.5, phones: -1 },
        rhythm: { label: 'public-data', passed: true, sensitivity: 89, specificity: Number.NaN },
        hrv: { label: 'checked', passed: true, withinPct: 700 },
      }),
    );
    expect(hr).toMatchObject({ error: null, ci95: null, people: null, phones: null });
    expect(rhythm).toMatchObject({ sensitivity: null, specificity: null });
    expect(hrv.withinPct).toBeNull();
  });

  it('reads the file date only when it is text', () => {
    expect(readEvidenceDate(fileWith({}, '2026-10-20'))).toBe('2026-10-20');
    expect(readEvidenceDate(fileWith({}, null))).toBeNull();
    expect(readEvidenceDate(undefined)).toBeNull();
  });
});

describe('countChecked', () => {
  it('follows the file: more passed labels, a higher count of the same total', () => {
    const none = countChecked(readAccuracy(fileWith({})));
    const one = countChecked(readAccuracy(fileWith({ hr: { label: 'checked', passed: true } })));
    const two = countChecked(
      readAccuracy(
        fileWith({ hr: { label: 'checked', passed: true }, rhythm: { label: 'public-data', passed: true } }),
      ),
    );
    expect([none.checked, one.checked, two.checked]).toEqual([0, 1, 2]);
    expect(new Set([none.total, one.total, two.total]).size).toBe(1);
  });

  it('does not count a label whose criterion did not pass', () => {
    const unpassed = readAccuracy(fileWith({ hr: { label: 'checked', passed: false } }));
    expect(countChecked(unpassed).checked).toBe(0);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import {
  HR_SUMMARY_NAMES,
  RHYTHM_FEATURE_NAMES,
  rhythmFeatureVector,
  rhythmV2Features,
  rhythmWindows,
} from '../src';

// A runtime refuses a manifest whose featureOrder disagrees with these lists, so they must match what the
// models were trained on (models/manifest.json, ml/train) and what core actually computes.
const repo = path.join(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'models/manifest.json'), 'utf8'));
type Entry = { family?: string; featureOrder?: unknown };
const entries: Entry[] = Array.isArray(manifest) ? manifest : manifest.models;

function window32() {
  const intervalsS = Array.from({ length: 32 }, (_, k) => 0.8 + 0.01 * Math.sin(k));
  return rhythmWindows(intervalsS, new Array(32).fill(false), new Array(33).fill(false))[0]!;
}

describe('ML-3 rhythm feature names', () => {
  it('are v1 rhythmFeatureVector (8) then rhythmV2Features (7), one name per value', () => {
    const window = window32();
    expect(RHYTHM_FEATURE_NAMES).toHaveLength(
      rhythmFeatureVector(window).length + rhythmV2Features(window).length,
    );
    expect(rhythmFeatureVector(window)).toHaveLength(8);
    expect(new Set(RHYTHM_FEATURE_NAMES).size).toBe(RHYTHM_FEATURE_NAMES.length);
  });

  it('every rhythm entry in models/manifest.json names a prefix of them', () => {
    const rhythm = entries.filter((entry) => Array.isArray(entry.featureOrder));
    expect(rhythm.length).toBeGreaterThan(0);
    for (const { featureOrder } of rhythm) {
      const names = featureOrder as string[];
      if (names[0] !== RHYTHM_FEATURE_NAMES[0]) continue; // not a rhythm model (e.g. sqi-rule)
      expect(names).toEqual(RHYTHM_FEATURE_NAMES.slice(0, names.length));
    }
  });

  it('ml/train/rhythm_windows.py FEATURE_NAMES is a prefix of them', () => {
    // There is no shared file for the names, so the Python tuple is read from its source.
    const source = fs.readFileSync(path.join(repo, 'ml/train/rhythm_windows.py'), 'utf8');
    const tuple = /^FEATURE_NAMES = \(\n([\s\S]*?)\n\)/m.exec(source);
    expect(tuple).not.toBeNull();
    const pythonNames = [...tuple![1]!.matchAll(/"(\w+)"/g)].map((match) => match[1]);
    expect(pythonNames).toEqual(RHYTHM_FEATURE_NAMES.slice(0, pythonNames.length));
  });
});

describe('ML-6 HR summary names', () => {
  it("match diabetes-net's manifest featureOrder.hrSummary", () => {
    const withSummary = entries.filter(
      (entry) =>
        typeof entry.featureOrder === 'object' &&
        entry.featureOrder !== null &&
        'hrSummary' in (entry.featureOrder as object),
    );
    expect(withSummary.length).toBeGreaterThan(0);
    for (const { featureOrder } of withSummary)
      expect((featureOrder as { hrSummary: string[] }).hrSummary).toEqual([...HR_SUMMARY_NAMES]);
  });
});

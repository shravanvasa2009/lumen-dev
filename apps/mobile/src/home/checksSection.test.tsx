import type { ReadingResult } from '@lumen/core';
import i18n from 'i18next';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import '@/i18n';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { makeReading } from '@/testing/reading';

import { ChecksSection } from './ChecksSection';
import type { StoredReading } from './readings';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

const mockEvidence = { diabetesMeasured: false };
jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return {
    ...actual,
    evidenceFor: (metric: string) =>
      metric === 'diabetes' && mockEvidence.diabetesMeasured
        ? { label: 'public-data', measured: true }
        : actual.evidenceFor(metric),
  };
});

const NOW = new Date(2026, 10, 3, 12, 0);

function reading(daysAgo: number, change: (metrics: ReadingResult['metrics']) => void): StoredReading {
  const saved = makeReading(new Date(2026, 10, 3 - daysAgo, 8, 0).getTime(), 64, null);
  change(saved.outcome.metrics);
  return saved;
}

const rhythm = (rhythmClass: 'sinus' | 'af') => (metrics: ReadingResult['metrics']) => {
  metrics.rhythm = {
    class: rhythmClass,
    pAF: 0.1,
    evidence: 'experimental',
    confidence: 'high',
    quality: 'standard',
    qualityReasons: [],
    flag: null,
  };
};
const rmssd = (band: [number, number] | null) => (metrics: ReadingResult['metrics']) => {
  metrics.rmssd = {
    value: 48.4,
    unit: 'ms',
    band,
    evidence: 'experimental',
    confidence: 'high',
    quality: 'standard',
    qualityReasons: [],
  };
};
const diabetes = (flag: 'pattern' | null) => (metrics: ReadingResult['metrics']) => {
  metrics.diabetes = {
    probability: 0.4,
    readingsUsed: 1,
    evidence: 'experimental',
    confidence: 'high',
    quality: 'standard',
    qualityReasons: [],
    flag,
  };
};

function show(readings: StoredReading[], compact = false) {
  return renderRouter({
    index: () => <ChecksSection readings={readings} now={NOW} compact={compact} />,
    'results/[id]': () => null,
  });
}

describe('check cards with no readings', () => {
  it('say so on AFib, HRV and Diabetes, and name the Standing test for POTS', () => {
    show([]);
    expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(3);
    expect(screen.getByText(en['checks.status.potsNone'])).toBeOnTheScreen();
  });
});

describe('check cards with saved readings', () => {
  it('give AFib the rhythm words of the newest reading that has one', () => {
    show([reading(0, rhythm('sinus')), reading(2, rhythm('af'))]);
    expect(screen.getByText(`${en['results.rhythmRegular']} · ${en['checks.today']}`)).toBeOnTheScreen();
  });

  it('dates an older rhythm finding by its day', () => {
    show([reading(2, rhythm('af'))]);
    expect(screen.getByText(`${en['results.rhythmIrregular']} · Nov 1`)).toBeOnTheScreen();
  });

  it('gives HRV the latest value, with the personal band only once one exists', () => {
    show([reading(0, rmssd([41.2, 55.4]))]);
    expect(screen.getByText('48 ms · your band 41–55')).toBeOnTheScreen();
  });

  it('gives HRV the value alone while the band is still learning', () => {
    show([reading(0, rmssd(null))]);
    expect(screen.getByText('48 ms')).toBeOnTheScreen();
  });

  it('counts Diabetes readings on different days, not readings', () => {
    show([reading(0, diabetes(null)), reading(0, diabetes(null))]);
    expect(screen.getByText('1 of 2 readings so far')).toBeOnTheScreen();
  });

  it('counts two days as 2 of 2 and still flags nothing', () => {
    show([reading(0, diabetes(null)), reading(1, diabetes(null))]);
    expect(screen.getByText('2 of 2 readings so far')).toBeOnTheScreen();
  });

  it('never shows the pattern wording while diabetes evidence is Experimental', () => {
    show([reading(0, diabetes('pattern')), reading(1, diabetes(null))]);
    expect(screen.queryByText(en['dm.flag.title'])).toBeNull();
    expect(screen.getByText('2 of 2 readings so far')).toBeOnTheScreen();
  });

  it('shows the existing pattern wording once diabetes evidence is measured', () => {
    mockEvidence.diabetesMeasured = true;
    try {
      show([reading(0, diabetes('pattern')), reading(1, diabetes(null))]);
      expect(screen.getByText(en['dm.flag.title'])).toBeOnTheScreen();
    } finally {
      mockEvidence.diabetesMeasured = false;
    }
  });

  it('ignores readings that carry no diabetes result', () => {
    show([reading(0, rhythm('sinus'))]);
    expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(2);
  });

  it('opens the reading behind a finding', () => {
    const saved = reading(0, rmssd(null));
    const route = show([saved]);
    fireEvent.press(screen.getByRole('button', { name: `${en['checks.hrv.name']}: 48 ms` }));
    expect(route.getPathname()).toBe(`/results/${saved.id}`);
  });

  it('keeps every Scan button on a compact screen', () => {
    show([], true);
    expect(screen.getAllByRole('button', { name: /^Scan for / })).toHaveLength(4);
  });
});

describe('check cards in Spanish', () => {
  beforeAll(() => i18n.changeLanguage('es'));
  afterAll(() => i18n.changeLanguage('en'));

  it('label each Scan button with the check name', () => {
    show([]);
    expect(screen.getByRole('button', { name: `Escanear ${es['checks.afib.name']}` })).toBeOnTheScreen();
    expect(screen.getByText(es['checks.status.potsNone'])).toBeOnTheScreen();
  });
});

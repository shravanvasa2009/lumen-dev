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
    qualityDetails: [],
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
    qualityDetails: [],
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
    qualityDetails: [],
    flag,
  };
};

function show(readings: StoredReading[]) {
  return renderRouter({
    index: () => <ChecksSection readings={readings} now={NOW} />,
    'results/[id]': () => null,
    trends: () => null,
    'measure/precheck': () => null,
    'measure/standing-test': () => null,
  });
}

describe('check rows with no readings', () => {
  it('say so on AFib, HRV and Diabetes, and name the Standing test for POTS', () => {
    show([]);
    expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(3);
    expect(screen.getByText(en['checks.status.potsNone'])).toBeOnTheScreen();
  });
});

describe('check rows with saved readings', () => {
  it('give AFib the rhythm words of the newest reading that has one', () => {
    show([reading(0, rhythm('sinus')), reading(2, rhythm('af'))]);
    expect(screen.getByText(`${en['results.rhythmRegular']} · ${en['checks.today']}`)).toBeOnTheScreen();
  });

  it('tags a lower-quality rhythm finding and HRV value (ADR 0104)', () => {
    const low = (metrics: ReadingResult['metrics']) => {
      rhythm('sinus')(metrics);
      rmssd(null)(metrics);
      Object.assign(metrics.rhythm!, {
        quality: 'low' as const,
        qualityReasons: ['shortClean' as const],
        qualityDetails: [],
      });
      Object.assign(metrics.rmssd!, {
        quality: 'low' as const,
        qualityReasons: ['shortClean' as const],
        qualityDetails: [],
      });
    };
    show([reading(0, low)]);
    const regular = en['quality.marked'].replace('{{value}}', en['results.rhythmRegular']);
    expect(screen.getByText(`${regular} · ${en['checks.today']}`)).toBeOnTheScreen();
    expect(screen.getByText(`${en['quality.marked'].replace('{{value}}', '48')} ms`)).toBeOnTheScreen();
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

  it('counts only the days whose Diabetes value is standard, as the mean does (ADR 0104)', () => {
    const lowDay = reading(1, diabetes(null));
    lowDay.outcome.metrics.diabetes!.quality = 'low';
    show([reading(0, diabetes(null)), lowDay]);
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

  it.each([
    ['afib', 'reading'],
    ['diabetes', 'reading'],
    ['hrv', 'trends'],
  ] as const)('opens the %s row on its %s', (check, target) => {
    const saved = reading(0, (metrics) => {
      rhythm('sinus')(metrics);
      rmssd(null)(metrics);
      diabetes(null)(metrics);
    });
    const route = show([saved]);
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${en[`checks.${check}.name`]}`) }));
    expect(route.getPathname()).toBe(target === 'reading' ? `/results/${saved.id}` : '/trends');
  });

  it.each([
    ['AFib', '/measure/precheck'],
    ['HRV', '/measure/precheck'],
    ['Diabetes', '/measure/precheck'],
    ['POTS', '/measure/standing-test'],
  ])('starts the right check from %s while it has no reading', (name, path) => {
    const route = show([]);
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    expect(route.getPathname()).toBe(path);
  });
});

describe('check rows in Spanish', () => {
  beforeAll(() => i18n.changeLanguage('es'));
  afterAll(() => i18n.changeLanguage('en'));

  it('shows the POTS line in Spanish', () => {
    show([]);
    expect(screen.getByText(es['checks.status.potsNone'])).toBeOnTheScreen();
  });
});

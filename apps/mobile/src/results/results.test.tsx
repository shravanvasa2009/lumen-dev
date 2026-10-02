import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import diabetes from '@/i18n/diabetes.json';
import es from '@/i18n/es.json';
import tokens from '@/theme/tokens.json';

import { readingById } from './fixtures';
import { formatClock, formatDay } from './format';
import { expectNavTitle } from '@/testing/navHeader';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const mockEvidence = { diabetesPassed: false };
jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return {
    ...actual,
    evidenceFor: (metric: string) =>
      metric === 'diabetes' && mockEvidence.diabetesPassed
        ? { label: 'public-data', measured: true }
        : actual.evidenceFor(metric),
  };
});

const mockDemo = { withoutPattern: false };
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      if (!mockDemo.withoutPattern || id !== 'demo') return reading;
      const { diabetes } = reading.scan.metrics;
      const metrics = { ...reading.scan.metrics, diabetes: { ...diabetes, flag: null } };
      return { ...reading, scan: { ...reading.scan, metrics } };
    },
  };
});

function openResults(id: string) {
  renderRouter('./app', { initialUrl: `/results/${id}` });
}

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('results in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
    mockEvidence.diabetesPassed = false;
    mockDemo.withoutPattern = false;
  });

  it('shows the demo reading with its cards and the accuracy footer', () => {
    openResults('demo');
    expect(screen.getByText('Regular rhythm, 64 bpm.')).toBeOnTheScreen();
    expect(screen.getByText(en['results.heartRhythm'])).toBeOnTheScreen();
    expect(screen.getByText('64 bpm')).toBeOnTheScreen();
    expect(screen.getByText('48 ms')).toBeOnTheScreen();
    expect(screen.getByText(en['result.notChecked'], { exact: false })).toBeOnTheScreen();
    const heading = screen.getByRole('header', { name: en['results.title'] });
    expect(StyleSheet.flatten(heading.props.style)).toMatchObject({ color: colors.text });
  });

  it('spells the meta line from the reading', () => {
    openResults('demo');
    const moment = readingById('demo')?.createdAt ?? new Date();
    expect(
      screen.getByText(`Full Scan · 92 clean s · ${formatDay(moment, 'en')}, ${formatClock(moment, 'en')}`),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Today/)).toBeNull();
  });

  it('keeps the diabetes estimate in Experimental measurements until the evidence file passes it', () => {
    openResults('demo');
    expect(screen.queryByText(en['dm.flag.body'])).toBeNull();
    expect(screen.getByText(en['dm.flag.title'])).toBeOnTheScreen();
    expect(screen.getByText(en['dm.experimental'])).toBeOnTheScreen();
    expect(screen.getByText('Experimental measurements (3)')).toBeOnTheScreen();
    expect(screen.getByText(en['results.sublineUsual'])).toBeOnTheScreen();
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('shows the amber diabetes card once the evidence file passes the diabetes metric', () => {
    mockEvidence.diabetesPassed = true;
    openResults('demo');
    expect(screen.getByText(en['dm.flag.title'])).toBeOnTheScreen();
    expect(screen.getByText(en['dm.flag.body'])).toBeOnTheScreen();
    expect(screen.getByText(/Seen on 2 readings \(Sep 25, Sep 27\)/)).toBeOnTheScreen();
    expect(screen.queryByText(en['dm.experimental'])).toBeNull();
    expect(screen.getByText(en['results.sublineFollowUp'])).toBeOnTheScreen();
    expect(screen.getByText('Experimental measurements (2)')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON()).includes(colors.flagBg)).toBe(true);
  });

  it('asks the safety question for the amber diabetes card, and Yes opens emergency (SAFE-1)', () => {
    mockEvidence.diabetesPassed = true;
    openResults('demo');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });

  it('shows no diabetes card and no accuracy-floor text when evidence passed but no pattern fired', () => {
    mockEvidence.diabetesPassed = true;
    mockDemo.withoutPattern = true;
    openResults('demo');
    expect(screen.queryByText(en['dm.flag.title'])).toBeNull();
    expect(screen.queryByText(en['dm.experimental'])).toBeNull();
    expect(screen.getByText('Experimental measurements (2)')).toBeOnTheScreen();
    expect(screen.queryByText(en['safety.title'])).toBeNull();
    expect(screen.getByText(en['results.sublineUsual'])).toBeOnTheScreen();
  });

  it('asks the safety question for a heart-rate flag alone, and Yes opens emergency (SAFE-1)', () => {
    openResults('demo-hr-flag');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });

  it('labels every fixture reading as demo data, and the irregular one as synthetic (§8.5)', () => {
    openResults('demo');
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.synthetic'])).toBeNull();
  });

  it('labels the irregular demo reading as synthetic', () => {
    openResults('demo-flag');
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.synthetic'])).toBeOnTheScreen();
    expect(screen.getByText(en['result.irregularRetake'])).toBeOnTheScreen();
  });

  it('opens the safety sheet again when the screen moves from one reading to a flagged one', () => {
    openResults('demo');
    expect(screen.queryByText(en['safety.title'])).toBeNull();
    act(() => router.push('/results/demo-flag'));
    expect(screen.getByText(en['safety.title'])).toBeOnTheScreen();
  });

  it('never draws a badge stronger than the evidence file (EVID-1)', () => {
    openResults('demo');
    const badges = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set([en['evidence.experimental']]));
  });

  it('draws no red on a flagged result (SAFE-1)', () => {
    openResults('demo-flag');
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.includes(colors.criticalFill)).toBe(false);
    expect(drawn.includes(colors.criticalText)).toBe(false);
  });

  it('asks the safety question for a rhythm flag, and No closes the sheet', () => {
    openResults('demo-flag');
    expect(screen.getByText(en['safety.title'])).toBeOnTheScreen();
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    expect(screen.getByText(en['result.irregularRetake'])).toBeOnTheScreen();
    expect(screen.getByText('Please take 2 more readings today.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['safety.no'] }));
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('opens the emergency screen when the answer is Yes (SAFE-1)', () => {
    openResults('demo-flag');
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });

  it('leaves HRV out of a Quick Check', () => {
    openResults('demo-flag');
    expect(screen.queryByText(en['results.hrv'])).toBeNull();
  });

  it('does not open the safety sheet when no heart-rate or rhythm flag fired', () => {
    openResults('demo');
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('shows no numbers for an unknown id', () => {
    openResults('missing');
    expect(screen.getByText(en['result.inconclusive'])).toBeOnTheScreen();
    expect(screen.queryByText(/bpm|\bms\b/)).toBeNull();
    expect(screen.queryByRole('button', { name: en['results.share'] })).toBeNull();
  });

  it('opens the experimental detail from its row', () => {
    openResults('demo');
    expect(screen.queryByText(en['results.notHealthMeasurement'])).toBeNull();
    fireEvent.press(screen.getByText(en['results.extraAndShape']));
    expect(screen.getByText(en['results.notHealthMeasurement'])).toBeOnTheScreen();
    expect(screen.getByText('Extra or skipped beats: 0.7 per minute')).toBeOnTheScreen();
  });

  it('labels confidence in words, not only dots', () => {
    openResults('demo');
    const labels = screen.getAllByTestId('confidence-dots').map((dots) => dots.props.accessibilityLabel);
    expect(labels).toEqual([en['confidence.high'], en['confidence.high'], en['confidence.moderate']]);
  });
});

describe('copy', () => {
  it('has a Spanish string for every results key', () => {
    for (const key of Object.keys(en).filter((name) => name.startsWith('results.'))) {
      expect(es).toHaveProperty([key]);
    }
  });

  it('keeps the diabetes strings equal to the wording-checked diabetes.json', () => {
    for (const key of ['dm.flag.title', 'dm.flag.body', 'dm.experimental'] as const) {
      expect(en[key]).toBe(diabetes.en[key]);
      expect(es[key]).toBe(diabetes.es[key]);
    }
  });
});

describe('Care map entry points', () => {
  beforeEach(() => {
    mockScheme = 'dark';
    mockEvidence.diabetesPassed = false;
    mockDemo.withoutPattern = false;
  });

  it('offers Find a doctor nearby under a flagged reading and keeps the safety sheet', async () => {
    openResults('demo-flag');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['careMap.enter'] }));
    expectNavTitle(en['careMap.title']);
    await screen.findByText(en['careMap.denied']);
  });

  it('offers it inside the amber diabetes card', async () => {
    mockEvidence.diabetesPassed = true;
    openResults('demo');
    fireEvent.press(screen.getByRole('button', { name: en['careMap.enter'] }));
    expectNavTitle(en['careMap.title']);
    await screen.findByText(en['careMap.denied']);
  });

  it('does not offer it on a reading with no flag', () => {
    openResults('demo');
    expect(screen.queryByRole('button', { name: en['careMap.enter'] })).toBeNull();
  });
});

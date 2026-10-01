import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import tokens from '@/theme/tokens.json';

import { readingById } from './fixtures';
import { formatClock } from './format';

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
    const clock = formatClock(readingById('demo')?.createdAt ?? new Date(), 'en');
    expect(screen.getByText(`Full Scan · 92 clean s · Today ${clock}`)).toBeOnTheScreen();
  });

  it('keeps the diabetes estimate in Experimental measurements until the evidence file passes it', () => {
    openResults('demo');
    expect(screen.queryByText(en['results.diabetesTitle'])).toBeNull();
    expect(screen.getByText(en['results.diabetesPattern'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.diabetesExperimental'])).toBeOnTheScreen();
    expect(screen.getByText('Experimental measurements (3)')).toBeOnTheScreen();
    expect(screen.getByText(en['results.sublineUsual'])).toBeOnTheScreen();
  });

  it('shows the amber diabetes card once the evidence file passes the diabetes metric', () => {
    mockEvidence.diabetesPassed = true;
    openResults('demo');
    expect(screen.getByText(en['results.diabetesTitle'])).toBeOnTheScreen();
    expect(screen.getByText(/Seen on 2 readings \(Sep 25, Sep 27\)/)).toBeOnTheScreen();
    expect(screen.queryByText(en['results.diabetesPattern'])).toBeNull();
    expect(screen.getByText(en['results.sublineFollowUp'])).toBeOnTheScreen();
    expect(screen.getByText('Experimental measurements (2)')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON()).includes(colors.flagBg)).toBe(true);
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
    expect(screen.getByText('Irregular rhythm detected')).toBeOnTheScreen();
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
});

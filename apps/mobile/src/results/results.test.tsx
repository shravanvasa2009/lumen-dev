import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Modal, StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import diabetes from '@/i18n/diabetes.json';
import es from '@/i18n/es.json';
import { focusedNavHeader } from '@/testing/navHeader';
import { pressNo } from '@/testing/pressNo';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { CLOSE_SHIELD_MS } from './SafetySheet';
import tokens from '@/theme/tokens.json';

import { readingById } from './fixtures';
import { formatClock, formatDay } from './format';
import { markSymptomsAsked } from './symptomsAsked';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const mockWindow = { width: 412, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindow.width, height: 900, scale: 2.6, fontScale: mockWindow.fontScale }),
}));

// The questionnaire card reads the database; diabetesRiskCard.test.tsx covers it.
jest.mock('@/profile/riskScore', () => ({ useStoredRiskScore: () => null }));

const mockEvidence = { diabetesPassed: false, rhythmPublic: false };
jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return {
    ...actual,
    evidenceFor: (metric: string) =>
      (metric === 'diabetes' && mockEvidence.diabetesPassed) ||
      (metric === 'rhythm' && mockEvidence.rhythmPublic)
        ? { label: 'public-data', measured: true }
        : actual.evidenceFor(metric),
  };
});

const mockDemo = { withoutPattern: false, ruleScored: false, hrOnly: false };
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      // The same reading with no rhythm judged, as buildReadingResult makes it with no rhythm card.
      if (mockDemo.hrOnly) {
        const metrics = { ...reading.scan.metrics, rhythm: null, rmssd: null };
        return { ...reading, scan: { ...reading.scan, headlineKey: 'result.hrOnly', metrics } };
      }
      if (id !== 'demo') return reading;
      if (mockDemo.ruleScored) {
        const rhythm = { ...reading.scan.metrics.rhythm, scorer: 'rule' };
        return { ...reading, scan: { ...reading.scan, metrics: { ...reading.scan.metrics, rhythm } } };
      }
      if (!mockDemo.withoutPattern) return reading;
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
    mockWindow.width = 412;
    mockWindow.fontScale = 1;
    mockEvidence.diabetesPassed = false;
    mockDemo.withoutPattern = false;
    mockEvidence.rhythmPublic = false;
    mockDemo.ruleScored = false;
    mockDemo.hrOnly = false;
  });

  it('shows the demo reading with its cards and the accuracy footer', () => {
    openResults('demo');
    expect(screen.getByText('Regular rhythm, 64 bpm.')).toBeOnTheScreen();
    expect(screen.getByText(en['results.heartRhythm'])).toBeOnTheScreen();
    expect(screen.getByText('64 bpm')).toBeOnTheScreen();
    expect(screen.getByText('48 ms')).toBeOnTheScreen();
    expect(screen.getByText(en['result.notChecked'], { exact: false })).toBeOnTheScreen();
    expect(focusedNavHeader()).toMatchObject({ title: en['results.title'], titleColor: colors.text });
    expect(screen.queryByRole('header', { name: en['results.title'] })).toBeNull();
  });

  it('spells the meta line from the reading', () => {
    openResults('demo');
    const moment = readingById('demo')?.createdAt ?? new Date();
    expect(
      screen.getByText(`Full Scan · 92 clean s · ${formatDay(moment, 'en')}, ${formatClock(moment, 'en')}`),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Today/)).toBeNull();
  });

  it('shows the Diabetes risk as a compact row, with the pulse pattern left to its detail screen (ADR 0082)', () => {
    openResults('demo');
    expect(screen.queryByText(en['dm.flag.body'])).toBeNull();
    expect(screen.getByText(en['dr.rowTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.demoRow'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.pulseExtra'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.notDiabetesTest'])).toBeOnTheScreen();
    expect(screen.queryByText(en['results.pulsePattern'])).toBeNull();
    expect(screen.queryByText(/%|AUC/)).toBeNull();
    expect(screen.getByText('Experimental measurements (2)')).toBeOnTheScreen();
    expect(screen.getByText(en['results.sublineUsual'])).toBeOnTheScreen();
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('never flags the diabetes row while the pulse model is Experimental, and shows no accuracy number', () => {
    openResults('demo');
    expect(screen.queryByText(en['results.flag'])).toBeNull();
    expect(screen.queryByText(en['dm.flag.title'])).toBeNull();
    expect(screen.queryByText(/%|AUC/)).toBeNull();
  });

  it('draws the headline card with a gradient fill', () => {
    openResults('demo');
    fireEvent(screen.getByTestId('headline-card'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 120 } },
    });
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.includes('RNSVGLinearGradient')).toBe(true);
    expect(drawn.includes('"width":320')).toBe(true);
  });

  it('orders the Full Scan as in v2 16: banner, headline, AFib, HRV, Diabetes, POTS, Heart rate, Experimental, Not checked', () => {
    openResults('demo');
    const drawn = JSON.stringify(screen.toJSON());
    const order = [
      en['demo.banner'],
      'Regular rhythm, 64 bpm.',
      en['results.heartRhythm'],
      en['results.hrv'],
      en['dr.rowTitle'],
      en['checks.pots.name'],
      en['results.heartRate'],
      'Experimental measurements',
      en['result.notChecked'],
    ].map((text) => drawn.indexOf(text));
    expect(order.every((position) => position > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(drawn.indexOf(en['result.notChecked'])).toBeLessThan(drawn.indexOf(en['results.showWhy']));
  });

  it('draws the Results title in the nav bar only, not again in the body', () => {
    openResults('demo');
    expect(screen.queryAllByText(en['results.title'])).toHaveLength(0);
    expect(focusedNavHeader()).toMatchObject({ title: en['results.title'] });
  });

  it('says POTS is not part of a Full Scan and links to the Standing test (ADR 0082)', () => {
    openResults('demo');
    expect(screen.getByText(en['checks.pots.name'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.notThisScan'])).toBeOnTheScreen();
    fireEvent.press(screen.getByText(en['results.takeStanding']));
    expect(screen.getByRole('header', { name: en['standing.title'] })).toBeOnTheScreen();
  });

  it('shows every card on a Quick Check, with the Standing test button (owner decision over ADR 0089)', () => {
    openResults('demo-flag');
    expect(screen.getByText(en['results.heartRhythm'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.hrv'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.breathing'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.rowTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['checks.pots.name'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['results.takeStanding'] })).toBeOnTheScreen();
  });

  it('lets card headers shrink', () => {
    openResults('demo');
    const heading = screen.getByText(en['results.heartRhythm']);
    expect(StyleSheet.flatten(heading.props.style).flexShrink).toBe(1);
  });

  it('stacks the footer buttons on a narrow phone or at large text, and keeps one row otherwise', () => {
    const footerDirection = () =>
      StyleSheet.flatten(screen.getByTestId('results-footer').props.style).flexDirection;
    mockWindow.width = 360;
    mockWindow.fontScale = 1;
    openResults('demo');
    expect(footerDirection()).toBe('column');
    expect(screen.getByRole('button', { name: en['results.showWhy'] })).toBeOnTheScreen();
    screen.unmount();
    mockWindow.width = 412;
    openResults('demo');
    expect(footerDirection()).toBe('row');
    screen.unmount();
    mockWindow.fontScale = 1.6;
    openResults('demo');
    expect(footerDirection()).toBe('column');
  });

  it('names the AFib check on the rhythm card', () => {
    openResults('demo');
    expect(screen.getByText(en['checks.afib.name'])).toBeOnTheScreen();
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
    expect(screen.queryByText(en['results.pulsePattern'])).toBeNull();
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

  it('does not ask again when Processing just asked for this reading, but asks when it is reopened', () => {
    markSymptomsAsked('demo-hr-flag');
    openResults('demo-hr-flag');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
    act(() => router.push('/results/demo-flag'));
    act(() => router.push('/results/demo-hr-flag'));
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
  });

  it('keeps the question open on a scrim tap and on Android Back (ADR 0093)', () => {
    openResults('demo-hr-flag');
    fireEvent.press(screen.getByTestId('sheet-scrim-press'));
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    pressNo();
    expect(screen.queryByText(en['safety.question'])).toBeNull();
  });

  it('cannot be silenced by a link carrying symptomsAsked (SAFE-1)', () => {
    openResults('demo-hr-flag?symptomsAsked=true');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
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

  it('says "Basic analysis" and caps the rhythm badge at Experimental for a rule-scored reading', () => {
    mockEvidence.rhythmPublic = true;
    mockDemo.ruleScored = true;
    openResults('demo');
    expect(screen.getByText(en['results.basicAnalysis'])).toBeOnTheScreen();
    expect(screen.queryAllByLabelText(en['evidence.publicData'])).toHaveLength(0);
  });

  it('shows no "Basic analysis" caption for a model-scored reading, and its badge keeps the file label', () => {
    mockEvidence.rhythmPublic = true;
    openResults('demo');
    expect(screen.queryByText(en['results.basicAnalysis'])).toBeNull();
    expect(screen.getAllByLabelText(en['evidence.publicData'])).toHaveLength(1);
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
    pressNo();
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('keeps the sheet up, dimmed and inert, until the close delay ends, and stays on Results (SAFE-1)', () => {
    const route = renderRouter('./app', { initialUrl: '/results/demo-flag' });
    const no = screen.getByRole('button', { name: en['safety.no'] });
    pressNo(CLOSE_SHIELD_MS - 1);
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(no);
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(route.getPathname()).toBe('/results/demo-flag');
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText(en['safety.title'])).toBeNull();
    expect(route.getPathname()).toBe('/results/demo-flag');
  });

  it('lays the safety question out large, in amber, and Yes still opens emergency at once (SAFE-1)', () => {
    openResults('demo-flag');
    const yes = screen.getByRole('button', { name: en['safety.yes'] });
    const no = screen.getByRole('button', { name: en['safety.no'] });
    for (const answer of [yes, no]) {
      expect(StyleSheet.flatten(answer.props.style).minHeight).toBeGreaterThanOrEqual(72);
    }
    expect(StyleSheet.flatten(yes.props.style)).toMatchObject({
      backgroundColor: colors.flagBg,
      borderColor: colors.flag,
    });
    expect(screen.getByRole('header', { name: en['safety.title'] })).toBeOnTheScreen();
    fireEvent.press(yes);
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('opens the emergency screen when the answer is Yes (SAFE-1)', () => {
    openResults('demo-flag');
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });

  it('headlines a reading with no rhythm by its heart rate and says why HRV is empty', () => {
    mockDemo.hrOnly = true;
    openResults('demo-flag');
    expect(screen.getByText(en['result.hrOnly'])).toBeOnTheScreen();
    expect(screen.queryByText(en['result.uncertain'])).toBeNull();
    expect(screen.getByText(en['quality.missingNoRhythm'])).toBeOnTheScreen();
    expect(screen.getByText('88 bpm')).toBeOnTheScreen();
  });

  it('keeps "Not enough clean signal" on the AFib and breathing cards when nothing names a cause', () => {
    mockDemo.hrOnly = true;
    openResults('demo');
    expect(screen.getByText(en['result.hrOnly'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['result.inconclusive'])).toHaveLength(1);
    expect(screen.getByText(en['quality.missingNoRhythm'])).toBeOnTheScreen();
  });

  it('does not open the safety sheet when no heart-rate or rhythm flag fired', () => {
    openResults('demo');
    expect(screen.queryByText(en['safety.title'])).toBeNull();
  });

  it('shows no numbers for an unknown id', async () => {
    openResults('missing');
    await waitFor(() => expect(screen.getByText(en['result.inconclusive'])).toBeOnTheScreen());
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
    expect(labels).toEqual([
      en['confidence.high'],
      en['confidence.moderate'],
      en['confidence.moderate'],
      en['confidence.high'],
    ]);
  });
});

preloadAppRoutes();

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
    mockDemo.hrOnly = false;
  });

  it('offers Find care near you under a flagged reading and keeps the safety sheet', async () => {
    openResults('demo-flag');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['results.findCare'] }));
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
    await screen.findByText(en['careMap.denied']);
  });

  it('offers it inside the amber diabetes card', async () => {
    mockEvidence.diabetesPassed = true;
    openResults('demo');
    fireEvent.press(screen.getByRole('button', { name: en['results.findCare'] }));
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
    await screen.findByText(en['careMap.denied']);
  });

  it('does not offer it on a reading with no flag', () => {
    openResults('demo');
    expect(screen.queryByRole('button', { name: en['results.findCare'] })).toBeNull();
  });
});

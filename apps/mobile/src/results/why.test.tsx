import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { processColor } from 'react-native';

import en from '@/i18n/en.json';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import tokens from '@/theme/tokens.json';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const mockEvidence = { rhythmPublic: false };
jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return {
    ...actual,
    evidenceFor: (metric: string) =>
      metric === 'rhythm' && mockEvidence.rhythmPublic
        ? { label: 'public-data', measured: true }
        : actual.evidenceFor(metric),
  };
});

const mockRhythm = { unclear: false, ruleScored: false };
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      if (!mockRhythm.unclear && !mockRhythm.ruleScored) return reading;
      const rhythm = mockRhythm.ruleScored
        ? { ...reading.scan.metrics.rhythm, scorer: 'rule' }
        : { ...reading.scan.metrics.rhythm, class: 'other', flag: null };
      return { ...reading, scan: { ...reading.scan, metrics: { ...reading.scan.metrics, rhythm } } };
    },
  };
});

function openWhy(id: string) {
  renderRouter('./app', { initialUrl: `/results/${id}/why` });
}

// The interval chart holds the only path (react-native-svg draws a Polyline as a Path); its stroke is the series colour.
// The Learn more chevron is also a path, so the search stays inside the chart.
function lineStrokes() {
  const chart = screen.getByLabelText(/^Line chart of \d+ beat-to-beat intervals$/);
  return chart.findAll((node) => String(node.type) === 'RNSVGPath').map((line) => line.props.stroke?.payload);
}

preloadAppRoutes();

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('show me why in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
    mockRhythm.unclear = false;
    mockRhythm.ruleScored = false;
    mockEvidence.rhythmPublic = false;
  });

  it('caps the rhythm badge at Experimental for a rule-scored reading (EVID-1, §11.10)', () => {
    mockEvidence.rhythmPublic = true;
    mockRhythm.ruleScored = true;
    openWhy('demo-flag');
    expect(screen.queryAllByLabelText(en['evidence.publicData'])).toHaveLength(0);
  });

  it('keeps the evidence-file label on the rhythm badge for a model-scored reading', () => {
    mockEvidence.rhythmPublic = true;
    openWhy('demo-flag');
    expect(screen.getAllByLabelText(en['evidence.publicData'])).toHaveLength(1);
  });

  it('explains an irregular reading with both charts in the flag colour', () => {
    openWhy('demo-flag');
    expect(screen.getByRole('header', { name: en['why.titleIrregular'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.intervals'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['why.learnMore'] }));
    expect(screen.getByText(en['why.poincare'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.yours'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.typical'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainIrregular'])).toBeOnTheScreen();
    expect(screen.getByText(`${en['results.noteIrregular']} · ${en['confidence.high']}`)).toBeOnTheScreen();
    expect(
      screen.getByText('0.7 per minute · frequent extra beats can also look irregular'),
    ).toBeOnTheScreen();
    expect(lineStrokes()).toEqual([processColor(colors.flag)]);
  });

  it('puts the plain sentence and badges before the charts', () => {
    openWhy('demo-flag');
    const order = JSON.stringify(screen.toJSON());
    const at = (text: string) => order.indexOf(text);
    expect(at(en['why.explainIrregular'])).toBeGreaterThan(-1);
    expect(at(en['why.explainIrregular'])).toBeLessThan(at(en['why.intervals']));
    expect(at(en['evidence.experimental'])).toBeLessThan(at(en['why.intervals']));
    expect(at(en['results.accuracy'])).toBeLessThan(at(en['why.intervals']));
  });

  it('folds the Poincare plots under a collapsed Learn more button that expands and collapses', () => {
    openWhy('demo-flag');
    const toggle = () => screen.getByRole('button', { name: en['why.learnMore'] });
    expect(toggle().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByText(en['why.poincare'])).toBeOnTheScreen();
    expect(screen.queryByText(en['why.yours'])).toBeNull();
    fireEvent.press(toggle());
    expect(toggle().props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText(en['why.yours'])).toBeOnTheScreen();
    fireEvent.press(toggle());
    expect(screen.queryByText(en['why.yours'])).toBeNull();
  });

  it('captions the sentence and the chart and ends with the not-a-diagnosis line', () => {
    openWhy('demo-flag');
    expect(screen.getByText(en['why.plainWords'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.seeBeats'])).toBeOnTheScreen();
    expect(screen.getByText(en['prototype.banner'])).toBeOnTheScreen();
  });

  it('does not invent an irregularity score', () => {
    openWhy('demo-flag');
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it('explains a regular reading in the accent colour', () => {
    openWhy('demo');
    expect(screen.getByRole('header', { name: en['why.titleRegular'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainRegular'])).toBeOnTheScreen();
    expect(lineStrokes()).toEqual([processColor(colors.accent)]);
  });

  it('draws a grey Experimental badge for extra beats and the rhythm badge from the evidence file', () => {
    openWhy('demo-flag');
    const badges = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
    expect(badges).toEqual([en['evidence.experimental'], en['evidence.experimental']]);
  });

  it('gives an unclear rhythm its own title and explanation, not the regular ones', () => {
    mockRhythm.unclear = true;
    openWhy('demo');
    expect(screen.getByRole('header', { name: en['why.titleOther'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainOther'])).toBeOnTheScreen();
    expect(screen.queryByText(en['why.titleRegular'])).toBeNull();
    expect(screen.queryByText(en['why.explainRegular'])).toBeNull();
  });

  it('labels the irregular demo as synthetic', () => {
    openWhy('demo-flag');
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.synthetic'])).toBeOnTheScreen();
  });

  it('shows the demo banner without the synthetic note on the regular reading', () => {
    openWhy('demo');
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.synthetic'])).toBeNull();
  });

  it('shows no chart for an unknown id', async () => {
    openWhy('missing');
    await waitFor(() => expectNavTitle(en['result.inconclusive']));
    expect(screen.queryByText(en['why.poincare'])).toBeNull();
  });
});

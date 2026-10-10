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

const mockRhythm = { unclear: false, ruleScored: false, low: false, tooShort: false };
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      if (mockRhythm.low) {
        const low = { quality: 'low', qualityReasons: ['shortClean'], qualityDetails: [] };
        const rhythm = { ...reading.scan.metrics.rhythm, ...low };
        const quality = { level: 'low', reasons: [{ kind: 'shortClean', haveS: 40, wantS: 60 }] };
        return {
          ...reading,
          scan: { ...reading.scan, quality, metrics: { ...reading.scan.metrics, rhythm } },
        };
      }
      if (mockRhythm.tooShort) {
        const rhythm = { ...reading.scan.metrics.rhythm, class: null, pAF: null, flag: null };
        return { ...reading, scan: { ...reading.scan, metrics: { ...reading.scan.metrics, rhythm } } };
      }
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
    mockRhythm.low = false;
    mockRhythm.tooShort = false;
    mockEvidence.rhythmPublic = false;
  });

  it('tags a lower-quality rhythm (ADR 0104)', () => {
    mockRhythm.low = true;
    openWhy('demo');
    expect(screen.getByRole('button', { name: en['quality.chip'] })).toBeOnTheScreen();
  });

  it('caps the rhythm badge at Experimental for a rule-scored reading (EVID-1, §11.10)', () => {
    mockEvidence.rhythmPublic = true;
    mockRhythm.ruleScored = true;
    openWhy('demo-flag');
    expect(screen.queryAllByLabelText(en['evidence.publicData'])).toHaveLength(0);
  });

  it('explains an irregular reading with the beats, the rhythm map and the interval chart in the flag colour', () => {
    openWhy('demo-flag');
    expect(screen.getByRole('header', { name: en['why.titleIrregular'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.intervals'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.poincare'])).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Your rhythm map: \d+ dots\. SD1 \d+ ms, SD2 \d+ ms\.$/)).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainIrregular'])).toBeOnTheScreen();
    expect(screen.getByText(`${en['results.noteIrregular']} · ${en['confidence.high']}`)).toBeOnTheScreen();
    expect(
      screen.getByText('0.7 per minute · frequent extra beats can also look irregular'),
    ).toBeOnTheScreen();
    expect(lineStrokes()).toEqual([processColor(colors.flag)]);
  });

  it('puts the plain sentence before the charts', () => {
    openWhy('demo-flag');
    const order = JSON.stringify(screen.toJSON());
    const at = (text: string) => order.indexOf(text);
    expect(at(en['why.explainIrregular'])).toBeGreaterThan(-1);
    expect(at(en['why.explainIrregular'])).toBeLessThan(at(en['why.intervals']));
    expect(at(en['results.accuracy'])).toBeLessThan(at(en['why.intervals']));
  });

  it('opens how a rhythm map is made in a sheet that Got it closes', () => {
    openWhy('demo-flag');
    expect(screen.queryByText(en['why.stepTimeTitle'])).toBeNull();
    fireEvent.press(screen.getByText(en['why.howMapMade']));
    expect(screen.getByText(en['why.stepTimeTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.stepPairTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.stepDotTitle'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['common.gotIt'] }));
    expect(screen.queryByText(en['why.stepTimeTitle'])).toBeNull();
  });

  it('lists next steps for an irregular reading, with Get help now, and none for a regular one', () => {
    openWhy('demo-flag');
    expect(screen.getByText(en['results.nextSteps'])).toBeOnTheScreen();
    expect(screen.getByText(en['why.askForBody'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['emergency.title'] }));
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });

  it('shows no next steps on a regular reading', () => {
    openWhy('demo');
    expect(screen.queryByText(en['results.nextSteps'])).toBeNull();
  });

  it('steps through the beats on the Beat by beat page', () => {
    openWhy('demo');
    fireEvent.press(screen.getByText(en['why.beatByBeat']));
    expect(screen.getByText('Gaps 1 to 6 of 40')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['why.earlier'] }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(screen.getByRole('button', { name: en['why.later'] }));
    expect(screen.getByText('Gaps 7 to 12 of 40')).toBeOnTheScreen();
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

  it('draws no badge while the extra beats and the rhythm are Experimental', () => {
    openWhy('demo-flag');
    expect(screen.queryAllByTestId('evidence-badge')).toEqual([]);
  });

  it('gives an unclear rhythm its own title and explanation, not the regular ones', () => {
    mockRhythm.unclear = true;
    openWhy('demo');
    expect(screen.getByRole('header', { name: en['why.titleOther'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainOther'])).toBeOnTheScreen();
    expect(screen.queryByText(en['why.titleRegular'])).toBeNull();
    expect(screen.queryByText(en['why.explainRegular'])).toBeNull();
  });

  it('says a rhythm too short to judge is that, never regular or irregular (ADR 0104 answer 5)', () => {
    mockRhythm.tooShort = true;
    openWhy('demo');
    expect(screen.getByRole('header', { name: en['results.rhythmTooShort'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.explainTooShort'])).toBeOnTheScreen();
    expect(screen.queryByText(en['why.titleRegular'])).toBeNull();
    expect(screen.queryByText(en['why.titleIrregular'])).toBeNull();
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
    expect(screen.queryByText(en['why.yourMap'])).toBeNull();
  });
});

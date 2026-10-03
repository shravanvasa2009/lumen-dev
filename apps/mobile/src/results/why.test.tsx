import { renderRouter, screen } from 'expo-router/testing-library';
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

const mockRhythm = { unclear: false };
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      if (!mockRhythm.unclear) return reading;
      const rhythm = { ...reading.scan.metrics.rhythm, class: 'other', flag: null };
      return { ...reading, scan: { ...reading.scan, metrics: { ...reading.scan.metrics, rhythm } } };
    },
  };
});

function openWhy(id: string) {
  renderRouter('./app', { initialUrl: `/results/${id}/why` });
}

// The interval chart is the only path on the screen (react-native-svg draws a Polyline as a Path); its stroke is the series colour.
function lineStrokes() {
  return screen.UNSAFE_root.findAll((node) => String(node.type) === 'RNSVGPath').map(
    (line) => line.props.stroke?.payload,
  );
}

preloadAppRoutes();

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('show me why in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
    mockRhythm.unclear = false;
  });

  it('explains an irregular reading with both charts in the flag colour', () => {
    openWhy('demo-flag');
    expect(screen.getByRole('header', { name: en['why.titleIrregular'] })).toBeOnTheScreen();
    expect(screen.getByText(en['why.intervals'])).toBeOnTheScreen();
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

  it('shows no chart for an unknown id', () => {
    openWhy('missing');
    expectNavTitle(en['result.inconclusive']);
    expect(screen.queryByText(en['why.poincare'])).toBeNull();
  });
});

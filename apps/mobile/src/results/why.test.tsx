import { renderRouter, screen } from 'expo-router/testing-library';
import { processColor } from 'react-native';

import en from '@/i18n/en.json';
import tokens from '@/theme/tokens.json';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

function openWhy(id: string) {
  renderRouter('./app', { initialUrl: `/results/${id}/why` });
}

// The interval chart is the only path on the screen (react-native-svg draws a Polyline as a Path); its stroke is the series colour.
function lineStrokes() {
  return screen
    .UNSAFE_root.findAll((node) => String(node.type) === 'RNSVGPath')
    .map((line) => line.props.stroke?.payload);
}

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('show me why in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
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

  it('shows no chart for an unknown id', () => {
    openWhy('missing');
    expect(screen.getByRole('header', { name: en['result.inconclusive'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['why.poincare'])).toBeNull();
  });
});

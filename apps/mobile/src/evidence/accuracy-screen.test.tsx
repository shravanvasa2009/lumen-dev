import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AccuracyScreen from '../../app/settings/accuracy';
import en from '@/i18n/en.json';

import '@/i18n';

// The screen reads the file when its module loads, so the mock is fixed per test file. Each metric has
// a different claim; only the first has both the label and the passed criterion.
jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: null,
  metrics: {
    hr: { label: 'checked', passed: true },
    rhythm: { label: 'public-data', passed: false },
    hrv: { label: 'experimental', passed: false },
    resp: { label: 'checked', passed: false },
    diabetes: { label: 'public-data', passed: false },
  },
}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

it('EVID-1: shows one badge per metric with the label the file supports', () => {
  render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <AccuracyScreen />
    </SafeAreaProvider>,
  );
  const shown = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
  expect(shown).toEqual([
    en['evidence.checked'],
    en['evidence.publicData'],
    en['evidence.experimental'],
    en['evidence.experimental'],
    en['evidence.publicData'],
    en['evidence.experimental'],
  ]);
  expect(screen.getByText(en['accuracy.diabetes'])).toBeTruthy();
  expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(5);
});

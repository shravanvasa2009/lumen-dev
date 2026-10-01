import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AccuracyScreen from '../../app/settings/accuracy';
import en from '@/i18n/en.json';

import '@/i18n';

jest.mock('../../assets/evidence.json', () => ({}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

it('EVID-1: with an empty evidence file every metric, diabetes included, is Experimental', () => {
  render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <AccuracyScreen />
    </SafeAreaProvider>,
  );
  const shown = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
  expect(shown).toEqual(Array(6).fill(en['evidence.experimental']));
  expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(6);
});

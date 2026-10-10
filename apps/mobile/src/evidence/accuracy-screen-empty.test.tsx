import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import AccuracyScreen from '../../app/settings/accuracy';
import en from '@/i18n/en.json';

import '@/i18n';

jest.mock('../../assets/evidence.json', () => ({}));

it('EVID-1: with an empty evidence file every metric, diabetes included, is Experimental', () => {
  renderRouter({ _layout: () => <Stack />, index: AccuracyScreen });
  const shown = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
  expect(shown).toEqual(Array(6).fill(en['evidence.experimental']));
  expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(7);
});

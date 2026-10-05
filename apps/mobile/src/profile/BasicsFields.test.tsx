import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from 'i18next';

import '@/i18n';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';

import { BasicsFields } from './BasicsFields';
import { EMPTY_RISK_DRAFT } from './diabetesRisk';

const labels = { en, es };

async function typeWeight(language: 'en' | 'es', text: string, imperial = false) {
  await act(() => i18n.changeLanguage(language));
  const change = jest.fn();
  render(<BasicsFields draft={EMPTY_RISK_DRAFT} change={change} />);
  const copy = labels[language];
  if (imperial) fireEvent.press(screen.getByRole('radio', { name: copy['profile.unitsImperial'] }));
  fireEvent.changeText(screen.getByLabelText(copy['profile.weight']), text);
  return { change, copy };
}

const lastWeightKg = (change: jest.Mock) =>
  change.mock.calls.filter(([field]) => field === 'weightKg').at(-1)?.[1];

afterEach(() => act(() => i18n.changeLanguage('en')));

describe('typed weight', () => {
  it.each([
    ['es', '70,5'],
    ['es', '70.5'],
    ['en', '70.5'],
  ] as const)('stores 70.5 kg for %s "%s"', async (language, text) => {
    const { change } = await typeWeight(language, text);
    expect(lastWeightKg(change)).toBe(70.5);
  });

  it('converts pounds typed with a comma to kilograms', async () => {
    const { change } = await typeWeight('es', '155,5', true);
    expect(lastWeightKg(change)).toBe(70.5);
  });

  it.each(['70,5,1', '1.234,5'])('stores nothing for "%s" and shows the weight message', async (text) => {
    const { change, copy } = await typeWeight('es', text);
    expect(lastWeightKg(change)).toBeNull();
    expect(
      screen.getByText(
        copy['profile.weightInvalid']
          .replace('{{min}}', '20')
          .replace('{{max}}', '300')
          .replace('{{unit}}', 'kg'),
      ),
    ).toBeOnTheScreen();
  });
});

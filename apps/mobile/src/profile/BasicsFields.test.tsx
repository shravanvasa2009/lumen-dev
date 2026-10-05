import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from 'i18next';
import { useState } from 'react';

import '@/i18n';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';

import { BasicsFields } from './BasicsFields';
import { EMPTY_RISK_DRAFT, type RiskDraft } from './diabetesRisk';

const labels = { en, es };

// Holds the draft like the real screen does, so out-of-range values reach assessRisk.
function Harness({ onChange }: { onChange: jest.Mock }) {
  const [draft, setDraft] = useState<RiskDraft>(EMPTY_RISK_DRAFT);
  return (
    <BasicsFields
      draft={draft}
      change={(field, value) => {
        onChange(field, value);
        setDraft((was) => ({ ...was, [field]: value }));
      }}
    />
  );
}

async function typeMeasure(
  field: 'height' | 'weight',
  language: 'en' | 'es',
  text: string,
  imperial = false,
) {
  await act(() => i18n.changeLanguage(language));
  const change = jest.fn();
  render(<Harness onChange={change} />);
  const copy = labels[language];
  if (imperial) fireEvent.press(screen.getByRole('radio', { name: copy['profile.unitsImperial'] }));
  fireEvent.changeText(screen.getByLabelText(copy[`profile.${field}`]), text);
  return { change, copy };
}

const lastStored = (change: jest.Mock, field: 'heightCm' | 'weightKg') =>
  change.mock.calls.filter(([name]) => name === field).at(-1)?.[1];

const message = (
  copy: typeof en,
  key: 'profile.heightInvalid' | 'profile.weightInvalid',
  range: { min: number; max: number },
  unit: string,
) =>
  copy[key]
    .replace('{{min}}', String(range.min))
    .replace('{{max}}', String(range.max))
    .replace('{{unit}}', unit);

afterEach(() => act(() => i18n.changeLanguage('en')));

describe('typed weight', () => {
  it.each([
    ['es', '70,5'],
    ['es', '70.5'],
    ['en', '70.5'],
  ] as const)('stores 70.5 kg for %s "%s"', async (language, text) => {
    const { change } = await typeMeasure('weight', language, text);
    expect(lastStored(change, 'weightKg')).toBe(70.5);
  });

  it('converts pounds typed with a comma to kilograms', async () => {
    const { change } = await typeMeasure('weight', 'es', '155,5', true);
    expect(lastStored(change, 'weightKg')).toBe(70.5);
  });

  it.each(['70,5,1', '1.234,5'])('stores nothing for "%s" and shows the weight message', async (text) => {
    const { change, copy } = await typeMeasure('weight', 'es', text);
    expect(lastStored(change, 'weightKg')).toBeNull();
    expect(
      screen.getByText(message(copy, 'profile.weightInvalid', { min: 20, max: 300 }, 'kg')),
    ).toBeOnTheScreen();
  });

  // A phone's maxLength={5} cuts a pasted "1.234,5" to "1.234", which reads as 1.234 kg.
  it('keeps a pasted "1.234,5" flagged invalid once the phone cuts it to "1.234"', async () => {
    const { change, copy } = await typeMeasure('weight', 'es', '1.234');
    expect(lastStored(change, 'weightKg')).toBe(1.2);
    expect(
      screen.getByText(message(copy, 'profile.weightInvalid', { min: 20, max: 300 }, 'kg')),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(`${copy['profile.bmi']} —`)).toBeOnTheScreen();
  });
});

describe('typed height', () => {
  it('stores 170.5 cm for Spanish "170,5"', async () => {
    const { change } = await typeMeasure('height', 'es', '170,5');
    expect(lastStored(change, 'heightCm')).toBe(170.5);
  });

  it('converts inches typed with a comma to centimetres rounded to a tenth', async () => {
    const { change } = await typeMeasure('height', 'es', '66,5', true);
    expect(lastStored(change, 'heightCm')).toBe(168.9);
  });

  it('stores nothing for "1,7,0" and shows the height message', async () => {
    const { change, copy } = await typeMeasure('height', 'es', '1,7,0');
    expect(lastStored(change, 'heightCm')).toBeNull();
    expect(
      screen.getByText(message(copy, 'profile.heightInvalid', { min: 100, max: 250 }, 'cm')),
    ).toBeOnTheScreen();
  });
});

describe('switching units with an unreadable value', () => {
  it('clears the field and the message and stores nothing', async () => {
    const { change, copy } = await typeMeasure('weight', 'es', '70,5,1');
    const field = screen.getByLabelText(copy['profile.weight']);
    expect(field.props.value).toBe('70,5,1');
    fireEvent.press(screen.getByRole('radio', { name: copy['profile.unitsImperial'] }));
    expect(screen.getByLabelText(copy['profile.weight']).props.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lastStored(change, 'weightKg')).toBeNull();
    expect(change.mock.calls.filter(([name]) => name === 'weightKg')).toHaveLength(1);
  });
});

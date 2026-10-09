import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import i18next from 'i18next';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';

import { CLOSE_SHIELD_MS, SafetySheet } from './SafetySheet';

import '@/i18n';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const originalWindow = Dimensions.get('window');

afterEach(() => {
  act(() => Dimensions.set({ window: originalWindow }));
});

describe('SafetySheet on a 360x640 phone at the largest font', () => {
  it('scrolls the title and question, and keeps Yes and No outside the scroll', () => {
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 2 } }));
    const onNo = jest.fn();
    const onYes = jest.fn();
    render(<SafetySheet visible onNo={onNo} onYes={onYes} />);
    const scrolling = within(screen.UNSAFE_getByType(ScrollView));
    expect(scrolling.getByText(en['safety.question'])).toBeOnTheScreen();
    expect(scrolling.getByRole('header', { name: en['safety.title'] })).toBeOnTheScreen();
    expect(scrolling.queryByRole('button')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(onYes).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: en['safety.no'] }));
    expect(onNo).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(CLOSE_SHIELD_MS));
    expect(onNo).toHaveBeenCalledTimes(1);
  });

  it('caps the panel below the screen height so the scroll area can shrink', () => {
    render(<SafetySheet visible onNo={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByTestId('sheet-drag').props.style).maxHeight).toBe('90%');
    expect(StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style).flexShrink).toBe(1);
    expect(StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.style).flexShrink).toBe(1);
  });

  it('reads in Spanish with Sí and No still answering', async () => {
    await act(() => i18next.changeLanguage('es'));
    try {
      render(<SafetySheet visible onNo={jest.fn()} onYes={jest.fn()} />);
      const scrolling = within(screen.UNSAFE_getByType(ScrollView));
      expect(scrolling.getByText(es['safety.question'])).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: es['safety.yes'] })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: es['safety.no'] })).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('ignores a second tap on No while it closes, and closes once', () => {
    const onNo = jest.fn();
    render(<SafetySheet visible onNo={onNo} />);
    const no = screen.getByRole('button', { name: en['safety.no'] });
    fireEvent.press(no);
    fireEvent.press(no);
    act(() => jest.advanceTimersByTime(CLOSE_SHIELD_MS));
    expect(onNo).toHaveBeenCalledTimes(1);
  });
});

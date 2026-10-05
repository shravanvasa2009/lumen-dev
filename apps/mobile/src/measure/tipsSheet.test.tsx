import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import en from '@/i18n/en.json';

import { TipsSheet } from './TipsSheet';

import '@/i18n';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

describe('TipsSheet', () => {
  it('scrolls the reminders and keeps Close outside the scroll, pressable', () => {
    const onDismiss = jest.fn();
    render(<TipsSheet visible onDismiss={onDismiss} />);
    const scrolling = within(screen.UNSAFE_getByType(ScrollView));
    expect(scrolling.getByRole('header', { name: en['precheck.reminders'] })).toBeOnTheScreen();
    expect(scrolling.queryByRole('button', { name: en['safety.dismiss'] })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: en['safety.dismiss'] }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

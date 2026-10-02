import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const continueButton = () => screen.getByRole('button', { name: en['common.continue'] });
const ageField = () => screen.getByLabelText(en['profile.age']);

describe('profile', () => {
  it('shows the age field, the three sex options and the four health notes', () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(ageField()).toBeOnTheScreen();
    for (const key of ['profile.female', 'profile.male', 'profile.preferNot'] as const)
      expect(screen.getByRole('radio', { name: en[key] })).toBeOnTheScreen();
    for (const key of [
      'profile.betaBlocker',
      'profile.pacemaker',
      'profile.afibReported',
      'profile.athlete',
    ] as const)
      expect(screen.getByRole('switch', { name: en[key] })).toBeOnTheScreen();
  });

  it('keeps Continue off until an age of 13 or more is entered', () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(continueButton()).toBeDisabled();
    fireEvent.changeText(ageField(), '12');
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText(en['profile.ageTooYoung'])).toBeOnTheScreen();
    fireEvent.changeText(ageField(), '13');
    expect(continueButton()).toBeEnabled();
    expect(screen.queryByText(en['profile.ageTooYoung'])).not.toBeOnTheScreen();
  });

  it('drops anything that is not a digit from the age', () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(ageField(), '4a2');
    expect(ageField().props.value).toBe('42');
  });

  it('selects one sex option at a time and flips a health note', () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.press(screen.getByRole('radio', { name: en['profile.male'] }));
    expect(screen.getByRole('radio', { name: en['profile.male'] })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: en['profile.preferNot'] }));
    expect(screen.getByRole('radio', { name: en['profile.male'] })).not.toBeChecked();
    const athlete = screen.getByRole('switch', { name: en['profile.athlete'] });
    fireEvent(athlete, 'valueChange', true);
    expect(screen.getByRole('switch', { name: en['profile.athlete'] })).toBeChecked();
  });
});

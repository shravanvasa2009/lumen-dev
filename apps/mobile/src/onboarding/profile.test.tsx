import { renderHook } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { useDoctorPhone } from '@/profile/doctorPhone';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const continueButton = () => screen.getByRole('button', { name: en['common.continue'] });
const ageField = () => screen.getByLabelText(en['profile.age']);

const phoneField = () => screen.getByLabelText(en['profile.doctorPhone']);

describe('profile', () => {
  afterEach(() => {
    const { result: doctorPhone } = renderHook(() => useDoctorPhone());
    act(() => doctorPhone.current.setPhone(null));
  });

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

  it('has an optional doctor phone field with a phone keypad that never blocks Continue', () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(phoneField().props.keyboardType).toBe('phone-pad');
    expect(en['profile.doctorPhone']).toContain('optional');
    expect(es['profile.doctorPhone']).toContain('opcional');
    fireEvent.changeText(ageField(), '40');
    expect(continueButton()).toBeEnabled();
    fireEvent.changeText(phoneField(), 'abc');
    expect(screen.getByText(en['profile.doctorPhoneInvalid'])).toBeOnTheScreen();
    expect(continueButton()).toBeEnabled();
  });

  it('saves a valid doctor phone, clears the error, and forgets it when emptied', () => {
    const { result: saved } = renderHook(() => useDoctorPhone());
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(phoneField(), '+1 (555) 010-0100');
    expect(screen.queryByText(en['profile.doctorPhoneInvalid'])).not.toBeOnTheScreen();
    expect(saved.current.phone).toBe('+1 (555) 010-0100');
    fireEvent.changeText(phoneField(), '555 x');
    expect(saved.current.phone).toBeNull();
    fireEvent.changeText(phoneField(), '');
    expect(screen.queryByText(en['profile.doctorPhoneInvalid'])).not.toBeOnTheScreen();
    expect(saved.current.phone).toBeNull();
  });
});

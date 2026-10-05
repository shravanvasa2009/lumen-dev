import { renderHook } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18n from 'i18next';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { lumenDatabase } from '@/store/database';
import { loadProfile, loadRiskDraft, saveHealthNote } from '@/store/profile';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const nextButton = () => screen.getByRole('button', { name: en['common.next'] });
const ageField = () => screen.findByLabelText(en['profile.age']);

const phoneField = () => screen.getByLabelText(en['profile.doctorPhone']);

preloadAppRoutes();

describe('profile', () => {
  beforeEach(emptyMockDatabases);

  afterEach(() => {
    jest.restoreAllMocks();
    const { result: doctorPhone } = renderHook(() => useDoctorPhone());
    act(() => doctorPhone.current.setPhone(null));
  });

  it('shows the age field, the three sex options and the four health notes', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(await ageField()).toBeOnTheScreen();
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

  it('keeps Next off until an age of 13 or more is entered', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(nextButton()).toBeDisabled();
    fireEvent.changeText(await ageField(), '12');
    expect(nextButton()).toBeDisabled();
    expect(screen.getByText(en['profile.ageTooYoung'])).toBeOnTheScreen();
    fireEvent.changeText(await ageField(), '13');
    expect(nextButton()).toBeEnabled();
    expect(screen.queryByText(en['profile.ageTooYoung'])).not.toBeOnTheScreen();
  });

  it('drops anything that is not a digit from the age', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '4a2');
    expect((await ageField()).props.value).toBe('42');
  });

  it('selects one sex option at a time and flips a health note', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    await ageField();
    fireEvent.press(screen.getByRole('radio', { name: en['profile.male'] }));
    expect(screen.getByRole('radio', { name: en['profile.male'] })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: en['profile.preferNot'] }));
    expect(screen.getByRole('radio', { name: en['profile.male'] })).not.toBeChecked();
    const athlete = screen.getByRole('switch', { name: en['profile.athlete'] });
    fireEvent(athlete, 'valueChange', true);
    expect(screen.getByRole('switch', { name: en['profile.athlete'] })).toBeChecked();
  });

  it('saves a health note as it is flipped and shows it again on the next visit', async () => {
    const first = renderRouter('./app', { initialUrl: '/profile' });
    fireEvent(screen.getByRole('switch', { name: en['profile.pacemaker'] }), 'valueChange', true);
    fireEvent(screen.getByRole('switch', { name: en['profile.afibReported'] }), 'valueChange', true);
    await waitFor(async () =>
      expect(await loadProfile()).toEqual({
        athlete: false,
        betaBlocker: false,
        pacemaker: true,
        knownAf: true,
      }),
    );
    first.unmount();
    renderRouter('./app', { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByRole('switch', { name: en['profile.pacemaker'] })).toBeChecked());
    expect(screen.getByRole('switch', { name: en['profile.betaBlocker'] })).not.toBeChecked();
  });

  it('has an optional doctor phone field with a phone keypad that never blocks Next', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    expect(phoneField().props.keyboardType).toBe('phone-pad');
    expect(en['profile.doctorPhone']).toContain('optional');
    expect(es['profile.doctorPhone']).toContain('opcional');
    fireEvent.changeText(await ageField(), '40');
    expect(nextButton()).toBeEnabled();
    fireEvent.changeText(phoneField(), 'abc');
    expect(screen.getByText(en['profile.doctorPhoneInvalid'])).toBeOnTheScreen();
    expect(nextButton()).toBeEnabled();
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

  it('shows an alert, and keeps the switch as flipped, when a health note cannot be saved', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValue(new Error('disk full'));
    renderRouter('./app', { initialUrl: '/profile' });
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    fireEvent(screen.getByRole('switch', { name: en['profile.pacemaker'] }), 'valueChange', true);
    await waitFor(() => expect(screen.getByText(en['profile.saveFailed'])).toBeOnTheScreen());
    expect(screen.getByRole('switch', { name: en['profile.pacemaker'] })).toBeChecked();
    expect(screen.queryByText(en['profile.loadFailed'])).not.toBeOnTheScreen();
  });

  it('says the saved answers could not be loaded, not that a save failed', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'getFirstAsync').mockRejectedValue(new Error('disk unreadable'));
    renderRouter('./app', { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByText(en['profile.loadFailed'])).toBeOnTheScreen());
    expect(screen.queryByText(en['profile.saveFailed'])).not.toBeOnTheScreen();
  });

  it('keeps a switch flipped before the saved answers arrive', async () => {
    await saveHealthNote('athlete', true);
    await saveHealthNote('betaBlocker', true);
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent(screen.getByRole('switch', { name: en['profile.athlete'] }), 'valueChange', false);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: en['profile.betaBlocker'] })).toBeChecked(),
    );
    expect(screen.getByRole('switch', { name: en['profile.athlete'] })).not.toBeChecked();
    await waitFor(async () => expect((await loadProfile()).athlete).toBe(false));
  });

  it('names the question set above the title', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    await ageField();
    expect(screen.getByText('Question set 1 of 2')).toBeOnTheScreen();
  });

  it('works out the body mass index live and never asks for it', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '52');
    expect(screen.getByLabelText(`${en['profile.bmi']} —`)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '168');
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '82');
    expect(screen.getByLabelText(`${en['profile.bmi']} 29.0`)).toBeOnTheScreen();
  });

  it('takes a decimal comma and shows the body mass index with one in Spanish', async () => {
    await act(() => i18n.changeLanguage('es'));
    try {
      renderRouter('./app', { initialUrl: '/profile' });
      fireEvent.changeText(await screen.findByLabelText(es['profile.age']), '52');
      fireEvent.changeText(screen.getByLabelText(es['profile.height']), '168');
      fireEvent.changeText(screen.getByLabelText(es['profile.weight']), '70,5');
      expect(screen.getByLabelText(`${es['profile.bmi']} 24,9`)).toBeOnTheScreen();
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });

  it('says what range a height or weight must be in and keeps Next off', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '52');
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '50');
    expect(screen.getByText('Enter a height between 100 and 250 cm.')).toBeOnTheScreen();
    expect(nextButton()).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '168');
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '10');
    expect(screen.getByText('Enter a weight between 20 and 300 kg.')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '300');
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '100');
    expect(screen.getByText(en['profile.bmiInvalid'])).toBeOnTheScreen();
    expect(nextButton()).toBeDisabled();
  });

  it('converts to inches and pounds for display and keeps metric underneath', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '52');
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '170');
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '80');
    fireEvent.press(screen.getByRole('radio', { name: en['profile.unitsImperial'] }));
    expect(screen.getByLabelText(en['profile.height']).props.value).toBe('66.9');
    expect(screen.getByLabelText(en['profile.weight']).props.value).toBe('176.4');
    expect(screen.getByLabelText(`${en['profile.bmi']} 27.6`)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '30');
    expect(screen.getByText('Enter a height between 40 and 98 in.')).toBeOnTheScreen();
  });

  it('stores the basics when Next is pressed and opens the second question set', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '52');
    fireEvent.press(screen.getByRole('radio', { name: en['profile.female'] }));
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '168');
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '82');
    fireEvent.press(nextButton());
    expect(await screen.findByRole('header', { name: en['dr.title'] })).toBeOnTheScreen();
    expect(await loadRiskDraft()).toMatchObject({ ageYears: 52, sex: 'female', heightCm: 168, weightKg: 82 });
  });

  it('shows the saved basics again on the next visit', async () => {
    const first = renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '47');
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '180');
    fireEvent.press(nextButton());
    await screen.findByRole('header', { name: en['dr.title'] });
    first.unmount();
    renderRouter('./app', { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByLabelText(en['profile.age']).props.value).toBe('47'));
    expect(screen.getByLabelText(en['profile.height']).props.value).toBe('180');
  });

  it('shows an alert and stays on the screen when the basics cannot be stored', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await ageField(), '52');
    const database = await lumenDatabase();
    jest.spyOn(database, 'withTransactionAsync').mockRejectedValue(new Error('disk full'));
    fireEvent.press(nextButton());
    await waitFor(() => expect(screen.getByText(en['profile.saveFailed'])).toBeOnTheScreen());
    expect(screen.queryByRole('header', { name: en['dr.title'] })).not.toBeOnTheScreen();
  });
});

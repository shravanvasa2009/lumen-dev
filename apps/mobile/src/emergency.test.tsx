import { act, renderHook, within } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Dimensions, Linking, ScrollView } from 'react-native';

import en from '@/i18n/en.json';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

fixClockAtMorning();

preloadAppRoutes();

function savePhone(phone: string | null) {
  const store = renderHook(() => useDoctorPhone());
  act(() => store.result.current.setPhone(phone));
}

const originalWindow = Dimensions.get('window');

describe('emergency screen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    savePhone(null);
    act(() => Dimensions.set({ window: originalWindow }));
  });

  it('has no Care map entry; it is only for calling emergency services', () => {
    renderRouter('./app', { initialUrl: '/emergency' });
    expect(screen.queryByRole('button', { name: en['careMap.enter'] })).toBeNull();
  });

  it('opens the dialer for 911', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    renderRouter('./app', { initialUrl: '/emergency' });
    fireEvent.press(screen.getByRole('button', { name: en['emergency.call'] }));
    expect(openURL).toHaveBeenCalledWith('tel:911');
    await Promise.resolve();
    expect(screen.queryByText(en['emergency.callFailed'])).toBeNull();
  });

  it('tells the person to dial 911 when the phone cannot place the call', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no dialer'));
    renderRouter('./app', { initialUrl: '/emergency' });
    fireEvent.press(screen.getByRole('button', { name: en['emergency.call'] }));
    expect(await screen.findByText(en['emergency.callFailed'])).toBeOnTheScreen();
  });

  it('returns to Home when there is nothing to go back to', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/emergency' });
    fireEvent.press(screen.getByRole('button', { name: en['emergency.okay'] }));
    expect(await screen.findByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
  });

  it('shows the stroke signs and no made-up doctor number', () => {
    renderRouter('./app', { initialUrl: '/emergency' });
    expect(screen.getByText(en['emergency.strokeLetters'])).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('offers no Call my doctor when no number is saved', () => {
    renderRouter('./app', { initialUrl: '/emergency' });
    expect(screen.queryByRole('button', { name: en['careMap.callMyDoctor'] })).toBeNull();
    expect(screen.getByRole('button', { name: en['emergency.call'] })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['emergency.okay'] })).toBeOnTheScreen();
  });

  it('dials the saved doctor number under Call 911', () => {
    savePhone('(713) 555-0100');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    renderRouter('./app', { initialUrl: '/emergency' });
    expect(
      screen.getAllByRole('button').map((button) => within(button).getByText(/./).props.children),
    ).toEqual([en['emergency.call'], en['careMap.callMyDoctor'], en['emergency.okay']]);
    fireEvent.press(screen.getByRole('button', { name: en['careMap.callMyDoctor'] }));
    expect(openURL).toHaveBeenCalledWith('tel:7135550100');
  });

  it('shows the doctor number as selectable text when the call cannot start', async () => {
    savePhone('(713) 555-0100');
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no dialer'));
    renderRouter('./app', { initialUrl: '/emergency' });
    fireEvent.press(screen.getByRole('button', { name: en['careMap.callMyDoctor'] }));
    const number = await screen.findByText('(713) 555-0100');
    expect(number.props.selectable).toBe(true);
  });

  it('keeps every action out of the scrolling block on a 360x640 phone', async () => {
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    savePhone('(713) 555-0100');
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no dialer'));
    renderRouter('./app', { initialUrl: '/emergency' });
    fireEvent.press(screen.getByRole('button', { name: en['emergency.call'] }));
    fireEvent.press(screen.getByRole('button', { name: en['careMap.callMyDoctor'] }));
    await screen.findByText(en['emergency.callFailed']);
    const scrolling = within(screen.UNSAFE_getByType(ScrollView));
    expect(scrolling.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
    expect(scrolling.queryByRole('button')).toBeNull();
    expect(scrolling.queryByText(en['emergency.callFailed'])).toBeNull();
  });
});

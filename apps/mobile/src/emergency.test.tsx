import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import en from '@/i18n/en.json';

describe('emergency screen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
});

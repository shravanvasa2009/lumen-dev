import { type Notification, setNotificationHandler } from 'expo-notifications';

import '../../app/_layout';

import { foregroundBehavior, showNotificationsInForeground } from './foreground';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  setNotificationHandler: jest.fn(),
}));

function arrived(identifier: string): Notification {
  return {
    date: 0,
    request: {
      identifier,
      content: {
        title: null,
        subtitle: null,
        body: 'Time for a reading.',
        // eslint-disable-next-line id-denylist -- the field name belongs to expo-notifications' content type.
        data: { url: 'lumen://standing' },
        categoryIdentifier: null,
        sound: null,
      },
      trigger: null,
    },
  };
}

describe('alerts while Lumen is open', () => {
  it('are shown from app start', () => {
    expect(setNotificationHandler).toHaveBeenCalledWith(
      // eslint-disable-next-line no-restricted-syntax -- the field name belongs to expo-notifications' handler type.
      expect.objectContaining({ handleNotification: foregroundBehavior }),
    );
  });

  it('show every Lumen alert and sound only the standing-test ones', async () => {
    await expect(foregroundBehavior(arrived('standing-2026-10-05T12:06'))).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
    await expect(foregroundBehavior(arrived('daily-2026-10-06T08:00'))).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('reports an alert that could not be shown', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    showNotificationsInForeground();
    const handler = jest.mocked(setNotificationHandler).mock.lastCall?.[0];
    // eslint-disable-next-line no-restricted-syntax -- the field name belongs to expo-notifications' handler type.
    handler?.handleError?.('standing-2026-10-05T12:06', new Error('timed out'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    warn.mockRestore();
  });
});

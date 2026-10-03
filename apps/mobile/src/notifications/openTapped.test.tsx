import { DEFAULT_ACTION_IDENTIFIER, type NotificationResponse } from 'expo-notifications';
import { renderRouter } from 'expo-router/testing-library';

import { redirectSystemPath } from '../deepLinks';

let mockResponse: NotificationResponse | null = null;

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  useLastNotificationResponse: () => mockResponse,
}));
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(60_000);

function tapped(url: string, actionIdentifier = DEFAULT_ACTION_IDENTIFIER): NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: 0,
      request: {
        identifier: 'confirm-2026-10-04T11:45',
        content: {
          title: null,
          subtitle: null,
          body: 'A follow-up check is due.',
          // eslint-disable-next-line id-denylist -- the field name belongs to expo-notifications' content type.
          data: { url },
          categoryIdentifier: null,
          sound: null,
        },
        trigger: null,
      },
    },
  };
}

describe('notification routes', () => {
  it.each([
    ['lumen://check', '/measure/precheck?mode=quick'],
    ['lumen://check/', '/measure/precheck?mode=quick'],
    ['lumen://check?mode=full', '/measure/precheck?mode=full'],
    ['lumen://check?mode=quick', '/measure/precheck?mode=quick'],
    ['lumen://standing', '/measure/standing-test'],
    ['/follow-up', '/follow-up'],
    ['/settings/phone', '/settings/phone'],
  ])('opens %s at %s', (link, path) => {
    expect(redirectSystemPath({ path: link })).toBe(path);
  });
});

describe('tapping a notification', () => {
  afterEach(() => {
    mockResponse = null;
  });

  it('opens the screen the notification points at', () => {
    mockResponse = tapped('lumen://check?mode=full');
    const view = renderRouter('./app', { initialUrl: '/settings/notifications' });
    expect(view.getPathname()).toBe('/measure/precheck');
    expect(view.getSearchParams()).toEqual({ mode: 'full' });
  });

  it('ignores a response that was not a tap on the notification itself', () => {
    mockResponse = tapped('lumen://standing', 'dismiss');
    const view = renderRouter('./app', { initialUrl: '/settings/notifications' });
    expect(view.getPathname()).toBe('/settings/notifications');
  });
});

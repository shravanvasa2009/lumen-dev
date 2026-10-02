import { renderRouter } from 'expo-router/testing-library';

import { redirectSystemPath } from '../../app/+native-intent';

// Resolved against the working directory, which is apps/mobile when the mobile workspace runs jest.
const appDirectory = './app';

const links = [
  { link: 'lumen://check', path: '/measure/precheck', mode: 'quick' },
  { link: 'lumen://check/', path: '/measure/precheck', mode: 'quick' },
  { link: 'lumen://check?mode=quick', path: '/measure/precheck', mode: 'quick' },
  { link: 'lumen://check?mode=full', path: '/measure/precheck', mode: 'full' },
  { link: 'lumen://check?source=widget&mode=full', path: '/measure/precheck', mode: 'full' },
  { link: 'LUMEN://Check?Mode=Full', path: '/measure/precheck', mode: 'full' },
  { link: 'lumen://standing', path: '/measure/standing-test', mode: undefined },
] as const;

describe('widget and notification links', () => {
  it.each(links)('$link opens $path', ({ link, path, mode }) => {
    const redirected = redirectSystemPath({ path: link });
    const route = renderRouter(appDirectory, { initialUrl: redirected });
    expect(route.getPathname()).toBe(path);
    expect(route.getSearchParams()).toEqual(mode === undefined ? {} : { mode });
  });

  it.each([
    '/settings/widgets',
    '/measure/precheck?mode=full',
    'lumen://settings',
    'lumen://checkup',
    'lumen://standing-test',
    'lumen://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081',
  ])('leaves %s unchanged', (path) => {
    expect(redirectSystemPath({ path })).toBe(path);
  });
});

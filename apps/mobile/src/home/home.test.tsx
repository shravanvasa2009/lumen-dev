import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n from 'i18next';
import { Dimensions } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { saveTestReading } from '@/testing/savedReading';
import { startOnboarded } from '@/testing/onboarded';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

let mockName: string | null = null;
jest.mock('@/profile/profileName', () => ({
  useProfileName: () => ({ name: mockName, problem: null, setName: () => undefined }),
}));

fixClockAtMorning();

preloadAppRoutes();

describe('Home', () => {
  let route: ReturnType<typeof renderRouter>;
  beforeEach(async () => {
    await startOnboarded();
    route = renderRouter('./app', { initialUrl: '/' });
    await screen.findByRole('header', { name: en['home.greetingMorning'] });
  });

  it('greets by time of day under the date line', () => {
    expect(screen.getByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
    expect(screen.getByText('Thursday, Oct 1')).toBeOnTheScreen();
  });

  it('shows the Measure circle with the default mode and its duration', () => {
    const measure = screen.getByRole('button', { name: en['home.measure'] });
    expect(measure.props.accessibilityHint).toBe('Full Scan · 90 s');
    expect(screen.getByText('Full Scan · 90 s')).toBeOnTheScreen();
  });

  it('shows empty states, not numbers, while no readings are stored', () => {
    expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(3);
    expect(screen.getByText(en['checks.status.potsNone'])).toBeOnTheScreen();
    expect(screen.queryByText(en['home.latestTitle'])).toBeNull();
    expect(screen.getByText(en['home.checksTitle'])).toBeOnTheScreen();
  });

  it('reaches follow-up from Home', () => {
    fireEvent.press(screen.getByRole('button', { name: en['home.followUp'] }));
    expect(screen.getByRole('header', { name: en['followUp.title'] })).toBeOnTheScreen();
  });

  it('shows the four checks as rows', () => {
    for (const name of ['afib', 'hrv', 'diabetes', 'pots'] as const)
      expect(
        screen.getByRole('button', { name: new RegExp(`^${en[`checks.${name}.name`]}`) }),
      ).toBeOnTheScreen();
  });

  it('shows no evidence badge on any check row', () => {
    expect(screen.queryAllByTestId('evidence-badge')).toHaveLength(0);
  });

  it.each([
    ['AFib', '/measure/precheck'],
    ['HRV', '/measure/precheck'],
    ['Diabetes', '/measure/precheck'],
    ['POTS', '/measure/standing-test'],
  ])('starts the right check from the %s row while it has no reading', (name, path) => {
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    expect(route.getPathname()).toBe(path);
    if (path === '/measure/precheck') expect(route.getSearchParams()).toEqual({ mode: 'full' });
  });

  it('reaches the mode list from the mode pill', () => {
    fireEvent.press(screen.getByRole('button', { name: `Mode: ${en['mode.full']}. Change mode` }));
    expectNavTitle(en['mode.title']);
  });

  it('opens the widget gallery from the promo', () => {
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${en['home.promoTitle']}`) }));
    expectNavTitle(en['widgets.title']);
  });

  it('dismisses the promo with the close icon', () => {
    fireEvent.press(screen.getByRole('button', { name: en['home.promoDismiss'] }));
    expect(screen.queryByText(en['home.promoTitle'])).toBeNull();
  });
});

describe('Home on a 360 x 640 phone', () => {
  const regular = Dimensions.get('window');
  beforeEach(async () => {
    Dimensions.set({ window: { width: 360, height: 640, scale: 3, fontScale: 1 } });
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/' });
    await screen.findByRole('header', { name: en['home.greetingMorning'] });
  });
  afterEach(() => Dimensions.set({ window: regular }));

  it('drops the date line and keeps Measure, the mode pill and the four check rows', () => {
    expect(screen.queryByText('Thursday, Oct 1')).toBeNull();
    expect(screen.getByRole('button', { name: en['home.measure'] })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Change mode$/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: new RegExp(`^${en['checks.pots.name']}`) })).toBeOnTheScreen();
  });
});

describe('Home in Spanish', () => {
  beforeAll(() => i18n.changeLanguage('es'));
  afterAll(() => i18n.changeLanguage('en'));

  it('greets and formats the date in Spanish', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: es['home.greetingMorning'] })).toBeOnTheScreen();
    expect(screen.getByText(/^jueves/i)).toBeOnTheScreen();
  });
});

describe('Home with stored readings', () => {
  it('shows the latest reading with its vitals and opens it', async () => {
    await startOnboarded();
    const id = await saveTestReading(new Date(2026, 9, 1, 8, 14).getTime(), 64);
    const route = renderRouter('./app', { initialUrl: '/' });
    await screen.findByText(en['home.latestTitle']);
    expect(screen.getByText('64')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText(/8:14/));
    expect(route.getPathname()).toBe(`/results/${id}`);
  });

  afterEach(() => {
    mockName = null;
  });

  it('greets by the name in the profile', async () => {
    await startOnboarded();
    mockName = 'Ana';
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: 'Good morning, Ana' })).toBeOnTheScreen();
  });
});

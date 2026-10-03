import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n from 'i18next';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { evidenceFor } from '@/evidence';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { startOnboarded } from '@/testing/onboarded';

import { MetricTile } from './MetricTile';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
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
    expect(screen.getAllByText(en['home.noValue'])).toHaveLength(3);
    for (const key of ['home.restingHr', 'home.hrv', 'home.breathing'] as const)
      expect(screen.getAllByText(en[key]).length).toBeGreaterThan(0);
  });

  it.each([
    ['follow-up', () => screen.getByRole('button', { name: en['home.followUp'] }), 'followUp.title'],
    [
      'a metric tile',
      () => screen.getByRole('button', { name: new RegExp(`^${en['home.hrv']}:`) }),
      'trends.title',
    ],
  ] as const)('reaches %s from Home', (_name, control, title) => {
    fireEvent.press(control());
    expect(screen.getByRole('header', { name: en[title] })).toBeOnTheScreen();
  });

  it('shows the four checks, each with a Scan button labelled by its name', () => {
    for (const name of ['afib', 'hrv', 'diabetes', 'pots'] as const) {
      const label = en[`checks.${name}.name`];
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: `Scan for ${label}` })).toBeOnTheScreen();
    }
  });

  it('takes the evidence badge of AFib, HRV and Diabetes from the evidence file, and none for POTS', () => {
    const words = {
      checked: en['evidence.checked'],
      'public-data': en['evidence.publicData'],
      experimental: en['evidence.experimental'],
    };
    const expected = (['rhythm', 'hrv', 'diabetes'] as const).map(
      (metric) => words[evidenceFor(metric).label],
    );
    expect(screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel)).toEqual(
      expected,
    );
  });

  it.each([
    ['AFib', '/measure/precheck'],
    ['HRV', '/measure/precheck'],
    ['Diabetes', '/measure/precheck'],
    ['POTS', '/measure/standing-test'],
  ])('starts the right check from the %s Scan button', (name, path) => {
    fireEvent.press(screen.getByRole('button', { name: `Scan for ${name}` }));
    expect(route.getPathname()).toBe(path);
  });

  it('reaches the mode list from Change mode', () => {
    fireEvent.press(screen.getByRole('button', { name: en['home.changeMode'] }));
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
  it('draws the latest value and a trend line on a tile', () => {
    renderRouter({ index: () => <MetricTile label="Resting HR" unit="bpm" points={[70, 66, 64.4]} /> });
    expect(screen.getByText('64')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGPath');
  });
});

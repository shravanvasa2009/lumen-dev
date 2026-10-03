import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n from 'i18next';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { makeReading } from '@/testing/reading';

import { LatestResultCard } from './LatestResultCard';
import { MetricTile } from './MetricTile';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

fixClockAtMorning();

preloadAppRoutes();

describe('Home', () => {
  beforeEach(() => {
    renderRouter('./app', { initialUrl: '/' });
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
    expect(screen.getByText(en['home.noReadings'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['home.noValue'])).toHaveLength(3);
    for (const key of ['home.restingHr', 'home.hrv', 'home.breathing'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
  });

  it.each([
    [
      'the latest result',
      () => screen.getByRole('button', { name: new RegExp(`^${en['home.latestResult']}`) }),
      'results.title',
    ],
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

  it('greets and formats the date in Spanish', () => {
    renderRouter('./app', { initialUrl: '/' });
    expect(screen.getByRole('header', { name: es['home.greetingMorning'] })).toBeOnTheScreen();
    expect(screen.getByText(/^jueves/i)).toBeOnTheScreen();
  });
});

describe('Home with stored readings', () => {
  it('shows the newest reading and the rounded latest value on each tile', () => {
    const now = new Date(2026, 9, 1, 9, 0);
    const newest = makeReading(new Date(2026, 9, 1, 7, 42).getTime(), 64.4, 48.2);
    renderRouter({ index: () => <LatestResultCard reading={newest} now={now} /> });
    expect(screen.getByText('Today, 7:42 AM')).toBeOnTheScreen();
    expect(screen.getByText('Regular rhythm, 64 bpm.')).toBeOnTheScreen();
  });

  it('draws the latest value and a trend line on a tile', () => {
    renderRouter({ index: () => <MetricTile label="Resting HR" unit="bpm" points={[70, 66, 64.4]} /> });
    expect(screen.getByText('64')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGPath');
  });
});

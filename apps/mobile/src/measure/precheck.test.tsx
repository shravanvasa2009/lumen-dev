import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { formatClock } from './restTimer';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(30_000);

preloadAppRoutes();

describe('formatClock', () => {
  it('writes minutes and zero-padded seconds', () => {
    expect(formatClock(120)).toBe('2:00');
    expect(formatClock(84)).toBe('1:24');
    expect(formatClock(5)).toBe('0:05');
  });
});

describe('pre-check', () => {
  let view: ReturnType<typeof renderRouter>;
  beforeEach(() => {
    jest.useFakeTimers();
    view = renderRouter('./app', { initialUrl: '/measure/precheck?mode=quick' });
  });
  // Unmount while the countdown's fake setTimeout is still installed, so its cleanup clears a timer it
  // owns; unmounting after the switch back to real timers hangs the testing-library cleanup on Node 22.
  afterEach(() => {
    screen.unmount();
    jest.useRealTimers();
  });

  it('counts the two-minute rest down one second at a time', () => {
    expect(screen.getByText('2:00')).toBeOnTheScreen();
    // Each tick schedules the next one after a re-render, so advance one second per act.
    for (let second = 0; second < 36; second++) act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('1:24')).toBeOnTheScreen();
  });

  it('ends the rest at once when skipped and hides the skip link', () => {
    fireEvent.press(screen.getByRole('button', { name: en['precheck.skip'] }));
    expect(screen.getByText('0:00')).toBeOnTheScreen();
    expect(screen.getByText(en['precheck.restDone'])).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en['precheck.skip'] })).toBeNull();
  });

  it('toggles each context chip independently', () => {
    const caffeine = screen.getByRole('checkbox', { name: en['precheck.caffeine'] });
    fireEvent.press(caffeine);
    expect(caffeine).toBeChecked();
    expect(screen.getByRole('checkbox', { name: en['precheck.exercise'] })).not.toBeChecked();
    fireEvent.press(caffeine);
    expect(caffeine).not.toBeChecked();
  });

  it('says Quick Check reads rhythm only and names the checks it leaves out', () => {
    expect(screen.getByText(`${en['checks.thisScanMode'].split('{{')[0]}${en['mode.quick']}`)).toBeOnTheScreen();
    expect(screen.getByText(en['checks.afib.name'])).toBeOnTheScreen();
    expect(screen.queryByTestId('evidence-badge')).toBeNull();
    expect(screen.getByText('Not in this scan: HRV, Diabetes, POTS')).toBeOnTheScreen();
  });

  it('starts the reading in the chosen mode from the pinned button', () => {
    fireEvent.press(screen.getByRole('button', { name: en['precheck.start'] }));
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
  });

  it('carries a skipped rest and the chosen chips to capture', () => {
    fireEvent.press(screen.getByRole('checkbox', { name: en['precheck.caffeine'] }));
    fireEvent.press(screen.getByRole('checkbox', { name: en['precheck.exercise'] }));
    fireEvent.press(screen.getByRole('button', { name: en['precheck.skip'] }));
    fireEvent.press(screen.getByRole('button', { name: en['precheck.start'] }));
    expect(view.getPathname()).toBe('/measure/capture');
    expect(view.getSearchParams()).toEqual({
      mode: 'quick',
      restDone: 'false',
      context: 'caffeine,exercise',
    });
  });

  it('reports the rest as done only after all 120 seconds', () => {
    for (let second = 0; second < 120; second++) act(() => jest.advanceTimersByTime(1000));
    fireEvent.press(screen.getByRole('button', { name: en['precheck.start'] }));
    expect(view.getSearchParams()).toEqual({ mode: 'quick', restDone: 'true', context: '' });
  });
});

describe('pre-check for a Full Scan', () => {
  it('lists AFib, HRV and Diabetes with its Experimental pill, and leaves POTS to the Standing test', () => {
    jest.useFakeTimers();
    renderRouter('./app', { initialUrl: '/measure/precheck?mode=full' });
    expect(screen.getByText(en['checks.hrv.name'])).toBeOnTheScreen();
    expect(screen.getByText(en['checks.diabetes.name'])).toBeOnTheScreen();
    expect(screen.getAllByTestId('evidence-badge')).toHaveLength(1);
    expect(screen.getByText('Not in this scan: POTS')).toBeOnTheScreen();
    screen.unmount();
    jest.useRealTimers();
  });
});

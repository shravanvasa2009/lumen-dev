import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

import { formatClock } from './restTimer';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(30_000);

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
  afterEach(() => jest.useRealTimers());

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

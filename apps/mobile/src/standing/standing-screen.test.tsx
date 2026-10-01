import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { DEMO_SPEED } from '@/standing/demo';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const appDirectory = './app';
const SECOND = 1000;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

function open(url: string) {
  renderRouter(appDirectory, { initialUrl: url });
}

function pressButton(name: string) {
  fireEvent.press(screen.getByRole('button', { name }));
}

function advanceDemoSeconds(testSeconds: number) {
  act(() => {
    jest.advanceTimersByTime((testSeconds * SECOND) / DEMO_SPEED);
  });
}

describe.each(['dark', 'light'] as const)('standing test in the %s theme', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('opens on the warning, the plan and the POTS heart-rate-only line', () => {
    open('/measure/standing-test');
    expect(screen.getByText(en['standing.warning'])).toBeOnTheScreen();
    expect(screen.getByText(en['standing.scope'])).toBeOnTheScreen();
    expect(screen.getByText('Step 1 of 5 · Get ready')).toBeOnTheScreen();
    expect(screen.queryByText(en['standing.demoBanner'])).toBeNull();
  });

  it('shows the Demo data banner, chart and values with ?demo=1', async () => {
    open('/measure/standing-test?demo=1');
    expect(screen.getByText(en['standing.demoBanner'])).toBeOnTheScreen();
    pressButton(en['standing.start']);
    advanceDemoSeconds(250);
    expect(screen.getByText('Step 3 of 5 · Baseline reading')).toBeOnTheScreen();
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText('68')).toBeOnTheScreen();
    advanceDemoSeconds(60 + 60);
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText('+16')).toBeOnTheScreen();
    expect(screen.getByText(en['standing.heading.standing'])).toBeOnTheScreen();
    expect(screen.getByLabelText(en['standing.chartLabel'])).toBeOnTheScreen();
  });
});

describe('standing test without demo', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  it('disables Take reading, says why, and shows no numbers', () => {
    open('/measure/standing-test');
    pressButton(en['standing.start']);
    act(() => {
      jest.advanceTimersByTime(250 * SECOND);
    });
    expect(screen.getByText(en['standing.takeLater'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['standing.take'] })).toBeDisabled();
    expect(screen.queryAllByText(/^[+-]?\d+$/)).toHaveLength(0);
    expect(screen.queryByText(en['standing.demoBanner'])).toBeNull();
  });

  it('counts the lying period down in real time', () => {
    open('/measure/standing-test');
    pressButton(en['standing.start']);
    act(() => {
      jest.advanceTimersByTime(90 * SECOND);
    });
    expect(screen.getByText('03:30')).toBeOnTheScreen();
  });

  it('stops the test and offers sitting down on I feel faint', () => {
    open('/measure/standing-test');
    pressButton(en['standing.start']);
    pressButton(en['standing.faint']);
    expect(screen.getByText(en['standing.heading.stopped'])).toBeOnTheScreen();
    expect(screen.getByText(en['standing.faintBody'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['standing.sitting'] })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en['standing.take'] })).toBeNull();
  });
});

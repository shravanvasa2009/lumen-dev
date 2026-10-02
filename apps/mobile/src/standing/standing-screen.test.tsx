import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import EmergencyScreen from '../../app/emergency';
import '@/i18n';
import en from '@/i18n/en.json';
import { StandingTestScreen } from '@/standing/StandingTestScreen';
import type { StandingTestSource } from '@/standing/useStandingTest';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const SECOND = 1000;
const TEST_BASELINE_BPM = 68;
const TEST_STANDING_BPM = 84;

const noSource: StandingTestSource = { now: () => Date.now(), readHeartRate: null };
const injectedSource: StandingTestSource = {
  now: () => Date.now(),
  readHeartRate: async (minute) => (minute === 0 ? TEST_BASELINE_BPM : TEST_STANDING_BPM),
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

function open(source: StandingTestSource) {
  renderRouter({
    index: () => <StandingTestScreen source={source} />,
    emergency: EmergencyScreen,
  });
}

function pressButton(name: string) {
  fireEvent.press(screen.getByRole('button', { name }));
}

function advanceSeconds(seconds: number) {
  act(() => {
    jest.advanceTimersByTime(seconds * SECOND);
  });
}

describe.each(['dark', 'light'] as const)('standing test in the %s theme', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('opens on the warning and the POTS heart-rate-only line, with no step number', () => {
    open(injectedSource);
    expect(screen.getByText(en['standing.warning'])).toBeOnTheScreen();
    expect(screen.getByText(en['standing.scope'])).toBeOnTheScreen();
    expect(screen.queryByText(/^Step \d/)).toBeNull();
  });

  it('numbers the steps like mockup 21 and shows chart and values from an injected source', async () => {
    open(injectedSource);
    pressButton(en['standing.start']);
    expect(screen.getByText('Step 1 of 5 · Lie down')).toBeOnTheScreen();
    advanceSeconds(250);
    expect(screen.getByText('Step 2 of 5 · Baseline reading')).toBeOnTheScreen();
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText('68')).toBeOnTheScreen();
    advanceSeconds(60 + 60);
    expect(screen.getByText('Step 3 of 5 · Standing')).toBeOnTheScreen();
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText('+16')).toBeOnTheScreen();
    expect(screen.getByLabelText(en['standing.chartLabel'])).toBeOnTheScreen();
    advanceSeconds(9 * 60);
    expect(screen.getByText('Step 4 of 5 · Final reading')).toBeOnTheScreen();
    advanceSeconds(60);
    expect(screen.getByText('Step 5 of 5 · Summary')).toBeOnTheScreen();
  });
});

describe('standing test without a reading source', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  it('disables Start test and says readings arrive later', () => {
    open(noSource);
    expect(screen.getByText(en['standing.takeLater'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['standing.start'] })).toBeDisabled();
    expect(screen.queryAllByText(/^[+-]?\d+$/)).toHaveLength(0);
  });
});

describe('standing test with an injected source', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  it('counts the lying period down in real time', () => {
    open(injectedSource);
    pressButton(en['standing.start']);
    advanceSeconds(90);
    expect(screen.getByText('03:30')).toBeOnTheScreen();
  });

  it('disables Take reading while a read is pending', async () => {
    let finishReading: (bpm: number) => void = () => undefined;
    open({ now: () => Date.now(), readHeartRate: () => new Promise((resolve) => (finishReading = resolve)) });
    pressButton(en['standing.start']);
    advanceSeconds(250);
    act(() => pressButton(en['standing.take']));
    expect(screen.getByRole('button', { name: en['standing.take'] })).toBeDisabled();
    await act(async () => finishReading(TEST_BASELINE_BPM));
    expect(screen.queryByRole('button', { name: en['standing.take'] })).toBeNull();
    expect(screen.getByText('68')).toBeOnTheScreen();
  });

  it('shows a visible line when a reading fails', async () => {
    open({ now: () => Date.now(), readHeartRate: () => Promise.reject(new Error('camera busy')) });
    pressButton(en['standing.start']);
    advanceSeconds(250);
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText(en['standing.readFailed'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['standing.take'] })).toBeEnabled();
  });

  it('shows the flag and Find a doctor nearby after two consecutive large rises', async () => {
    const highSource: StandingTestSource = {
      now: () => Date.now(),
      readHeartRate: async (minute) => (minute === 0 ? TEST_BASELINE_BPM : TEST_BASELINE_BPM + 32),
    };
    open(highSource);
    pressButton(en['standing.start']);
    advanceSeconds(250);
    await act(async () => pressButton(en['standing.take']));
    advanceSeconds(120);
    await act(async () => pressButton(en['standing.take']));
    expect(screen.queryByText(en['standing.flag'])).toBeNull();
    advanceSeconds(120);
    await act(async () => pressButton(en['standing.take']));
    expect(screen.getByText(en['standing.flag'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['careMap.enter'] })).toBeOnTheScreen();
  });

  it('shows no flag for a rise of 16 bpm', async () => {
    open(injectedSource);
    pressButton(en['standing.start']);
    advanceSeconds(250);
    await act(async () => pressButton(en['standing.take']));
    advanceSeconds(120);
    await act(async () => pressButton(en['standing.take']));
    advanceSeconds(120);
    await act(async () => pressButton(en['standing.take']));
    expect(screen.queryByText(en['standing.flag'])).toBeNull();
    expect(screen.queryByRole('button', { name: en['careMap.enter'] })).toBeNull();
  });

  it('stops the test and offers sitting down on I feel faint', () => {
    open(injectedSource);
    pressButton(en['standing.start']);
    pressButton(en['standing.faint']);
    expect(screen.getByText(en['standing.heading.stopped'])).toBeOnTheScreen();
    expect(screen.getByText(en['standing.faintBody'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['standing.sitting'] })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en['standing.take'] })).toBeNull();
  });

  it('leads from I feel faint to the emergency screen', () => {
    open(injectedSource);
    pressButton(en['standing.start']);
    pressButton(en['standing.faint']);
    pressButton(en['emergency.title']);
    expect(screen.getByRole('header', { name: en['emergency.title'] })).toBeOnTheScreen();
  });
});

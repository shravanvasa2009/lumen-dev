import { fireEvent, render, screen } from '@testing-library/react-native';

import en from '@/i18n/en.json';

import { CaptureView } from './CaptureView';
import type { LiveCapture } from './useLiveCapture';

import '@/i18n';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const base: LiveCapture = {
  phase: 'running',
  failure: null,
  status: { fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 60, droppedFrac: 0 },
  recentRed: [],
  elapsedS: 12.4,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
};

const show = (live: Partial<LiveCapture>, mode: 'quick' | 'full' = 'quick') => {
  const onCancel = jest.fn();
  const onStop = jest.fn();
  render(<CaptureView mode={mode} live={{ ...base, ...live }} onCancel={onCancel} onStop={onStop} />);
  return { onCancel, onStop };
};

describe('CaptureView', () => {
  it('says the camera is not connected when the module is unavailable', () => {
    show({ phase: 'unavailable', status: null });
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
    expect(screen.getByText(en['capture.unavailable'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.noWaveform'])).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.fingerDetected'])).toBeNull();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('explains a denied camera permission and a failed start', () => {
    show({ phase: 'denied', status: null });
    expect(screen.getByText(en['capture.denied'])).toBeOnTheScreen();
  });

  it('shows the start failure reason', () => {
    show({ phase: 'failed', status: null, failure: 'camera busy' });
    expect(screen.getByText("The camera didn't start: camera busy")).toBeOnTheScreen();
  });

  it('waits for a clean signal while there is no LiveSession count', () => {
    show({ elapsedS: 12.9 }, 'full');
    expect(screen.getByRole('header', { name: en['mode.full'] })).toBeOnTheScreen();
    expect(screen.getByText(en['capture.fingerDetected'])).toBeOnTheScreen();
    expect(
      screen.getByText('The camera has been on for 12 s. Waiting for a clean signal.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.getByText('of 90 clean s')).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.timerNote'])).toBeNull();
    expect(screen.queryByText(en['capture.still'])).toBeNull();
  });

  it('asks for the finger to cover the flash when none is detected', () => {
    show({ status: { ...base.status!, fingerCovered: false } });
    expect(screen.getByText(en['capture.fingerMissing'])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.flashOutsideBump'])).toBeOnTheScreen();
  });

  it('draws the pulse from the module samples', () => {
    show({ recentRed: [0.6, 0.62, 0.58, 0.61] });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.noWaveform'])).toBeNull();
  });

  it('counts clean seconds when a session supplies them', () => {
    show({ cleanSeconds: 18.7 });
    expect(screen.getByText('18')).toBeOnTheScreen();
    expect(screen.getByText('of 30 clean s')).toBeOnTheScreen();
    expect(screen.getByText(en['capture.good'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.timerNote'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.pressure'])).toBeOnTheScreen();
  });

  it('pauses with one coaching line and flags the failing check', () => {
    show({ cleanSeconds: 18, coachingKey: 'coach.lighter' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
    expect(screen.getByText('of 30 s · paused')).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.good'])).toBeNull();
  });

  it('cancels from the close button and stops from Stop', () => {
    const { onCancel, onStop } = show({});
    fireEvent.press(screen.getByRole('button', { name: en['capture.cancel'] }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: en['capture.stop'] }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

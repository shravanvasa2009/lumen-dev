import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { LiveWaveform } from './LiveWaveform';
import * as playback from './waveformPlayback';

const beats = Array.from({ length: 40 }, (_, index) => Math.sin(index / 3));
const times = beats.map((_, index) => index * 0.04);

function setSystemReduceMotion(on: boolean) {
  const calls = jest.mocked(AccessibilityInfo.addEventListener).mock.calls as unknown as [
    string,
    (on: boolean) => void,
  ][];
  const subscription = calls.find(([eventName]) => eventName === 'reduceMotionChanged');
  if (!subscription) throw new Error('nothing is watching Reduce Motion yet');
  act(() => subscription[1](on));
}

function renderCard(pulse = beats, pulseTimes = times) {
  render(<LiveWaveform pulse={pulse} red={beats} pulseTimesS={pulseTimes} redTimesS={times} />);
  fireEvent(screen.getByTestId('live-waveform-card'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 200 } },
  });
}

afterEach(() => {
  setSystemReduceMotion(false);
  jest.restoreAllMocks();
});

describe('LiveWaveform', () => {
  it('draws a curve path for each trace once the card has a width', () => {
    renderCard();
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('live-waveform-raw', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('draws a flat line while there are fewer than two values', () => {
    render(<LiveWaveform pulse={[]} red={[0.5]} pulseTimesS={[]} redTimesS={[0]} />);
    expect(screen.queryByTestId('live-waveform', { includeHiddenElements: true })).toBeNull();
  });

  it('draws a flat line when the values and their times do not line up', () => {
    renderCard(beats, times.slice(1));
    expect(screen.queryByTestId('live-waveform', { includeHiddenElements: true })).toBeNull();
  });

  it('leaves the drawing to the frame clock when motion is on', () => {
    const draw = jest.spyOn(playback, 'tracePath');
    renderCard();
    expect(draw).not.toHaveBeenCalled();
  });

  it('with Reduce Motion draws once per batch, right-aligned on the newest sample', () => {
    renderCard();
    const draw = jest.spyOn(playback, 'tracePath');
    setSystemReduceMotion(true);
    expect(draw).toHaveBeenCalled();
    const [, edge] = draw.mock.calls.at(-1)!;
    expect(edge).toBe(times[times.length - 1]);
  });
});

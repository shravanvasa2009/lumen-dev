import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Modal, Text } from 'react-native';

import { ReduceMotion } from 'react-native-reanimated';

import { motion, StillMotion, useReduceMotion } from '@/theme/motion';

import { BottomSheet } from './BottomSheet';
import { PressableScale } from './PressableScale';

const reanimated = jest.requireMock('react-native-reanimated');

function setSystemReduceMotion(on: boolean) {
  const calls = jest.mocked(AccessibilityInfo.addEventListener).mock.calls as unknown as [
    string,
    (on: boolean) => void,
  ][];
  const subscription = calls.find(([eventName]) => eventName === 'reduceMotionChanged');
  if (!subscription) throw new Error('nothing is watching Reduce Motion yet');
  act(() => subscription[1](on));
}

function renderPressable(onPress = jest.fn()) {
  render(
    <PressableScale accessibilityRole="button" onPress={onPress}>
      <Text>hold me</Text>
    </PressableScale>,
  );
  return screen.getByRole('button');
}

afterEach(() => {
  setSystemReduceMotion(false);
  jest.restoreAllMocks();
});

describe('PressableScale', () => {
  it('springs to the press scale while held and back to full size on release', () => {
    const spring = jest.spyOn(reanimated, 'withSpring');
    const button = renderPressable();
    fireEvent(button, 'pressIn');
    expect(spring).toHaveBeenLastCalledWith(motion.pressScale, motion.pressSpring);
    fireEvent(button, 'pressOut');
    expect(spring).toHaveBeenLastCalledWith(1, motion.pressSpring);
  });

  it("still delivers the press and the caller's own pressIn handler", () => {
    const onPress = jest.fn();
    const onPressIn = jest.fn();
    render(
      <PressableScale accessibilityRole="button" onPress={onPress} onPressIn={onPressIn}>
        <Text>hold me</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByRole('button'));
    fireEvent(screen.getByRole('button'), 'pressIn');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPressIn).toHaveBeenCalledTimes(1);
  });

  it('does not shrink when the phone has Reduce Motion on', () => {
    const spring = jest.spyOn(reanimated, 'withSpring');
    const button = renderPressable();
    setSystemReduceMotion(true);
    fireEvent(button, 'pressIn');
    expect(spring).toHaveBeenLastCalledWith(1, motion.pressSpring);
  });

  it('does not shrink on the capture screen (ADR 0075)', () => {
    const spring = jest.spyOn(reanimated, 'withSpring');
    render(
      <StillMotion.Provider value>
        <PressableScale accessibilityRole="button">
          <Text>hold me</Text>
        </PressableScale>
      </StillMotion.Provider>,
    );
    fireEvent(screen.getByRole('button'), 'pressIn');
    expect(spring).toHaveBeenLastCalledWith(1, motion.pressSpring);
  });
});

describe('BottomSheet motion', () => {
  const sheet = (
    <BottomSheet visible onDismiss={jest.fn()} dismissLabel="close">
      <Text>sheet</Text>
    </BottomSheet>
  );
  const animationType = () => screen.UNSAFE_getByType(Modal).props.animationType;
  const entering = (testID: string) => screen.getByTestId(testID).props.entering;

  it('fades the scrim and the panel in itself, never through the OS', () => {
    render(sheet);
    expect(animationType()).toBe('none');
    expect(entering('sheet-scrim')).toBeDefined();
    expect(entering('sheet-panel')).toBeDefined();
  });

  it('runs both at the 200 ms token and follows Reduce Motion while open', () => {
    const builders = [reanimated.FadeIn];
    const durations = builders.map((builder) => jest.spyOn(builder, 'duration'));
    const modes = builders.map((builder) => jest.spyOn(builder, 'reduceMotion'));
    // A Reanimated slide left the panel's touch geometry below the screen on Android, so a tap that moved at
    // all was dropped (owner, Galaxy A17, 2026-10-09). The panel must not slide in.
    const slide = jest.spyOn(reanimated.SlideInDown, 'duration');
    render(sheet);
    expect(slide).not.toHaveBeenCalled();
    durations.forEach((spy) => expect(spy).toHaveBeenLastCalledWith(motion.durationMs));
    modes.forEach((spy) => expect(spy).toHaveBeenLastCalledWith(ReduceMotion.Never));
    setSystemReduceMotion(true);
    expect(animationType()).toBe('none');
    modes.forEach((spy) => expect(spy).toHaveBeenLastCalledWith(ReduceMotion.Always));
    setSystemReduceMotion(false);
    modes.forEach((spy) => expect(spy).toHaveBeenLastCalledWith(ReduceMotion.Never));
  });

  it('appears without any fade or slide on the capture screen', () => {
    render(<StillMotion.Provider value>{sheet}</StillMotion.Provider>);
    expect(animationType()).toBe('none');
    expect(entering('sheet-scrim')).toBeUndefined();
    expect(entering('sheet-panel')).toBeUndefined();
  });
});

describe('useReduceMotion', () => {
  function Probe() {
    return <Text>{useReduceMotion() ? 'reduced' : 'full'}</Text>;
  }

  it('follows the phone setting while mounted', () => {
    render(<Probe />);
    expect(screen.getByText('full')).toBeOnTheScreen();
    setSystemReduceMotion(true);
    expect(screen.getByText('reduced')).toBeOnTheScreen();
    setSystemReduceMotion(false);
    expect(screen.getByText('full')).toBeOnTheScreen();
  });
});

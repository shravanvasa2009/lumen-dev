import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Modal, Text } from 'react-native';

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

  it('fades in, and stops animating when Reduce Motion is switched on while open', () => {
    render(sheet);
    expect(animationType()).toBe('fade');
    setSystemReduceMotion(true);
    expect(animationType()).toBe('none');
    setSystemReduceMotion(false);
    expect(animationType()).toBe('fade');
  });

  it('appears without animation on the capture screen', () => {
    render(<StillMotion.Provider value>{sheet}</StillMotion.Provider>);
    expect(animationType()).toBe('none');
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

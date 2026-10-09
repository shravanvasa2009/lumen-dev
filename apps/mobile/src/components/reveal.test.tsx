import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform, Text } from 'react-native';
import Animated from 'react-native-reanimated';

import '@/i18n';
import { QualityChip } from '@/measure/QualityChip';
import { stackAnimation, StillMotion } from '@/theme/motion';

import { Reveal, Settle, ValueSettle } from './Reveal';

describe('motion components', () => {
  it('shows the content of Reveal, Settle and ValueSettle', () => {
    render(
      <>
        <Reveal>
          <Text>revealed</Text>
        </Reveal>
        <Settle>
          <Text>settled</Text>
        </Settle>
        <ValueSettle value={12}>
          <Text>twelve</Text>
        </ValueSettle>
      </>,
    );
    for (const text of ['revealed', 'settled', 'twelve']) expect(screen.getByText(text)).toBeOnTheScreen();
  });

  it('keeps the new value when a ValueSettle value changes', () => {
    const view = render(
      <ValueSettle value="a">
        <Text>a</Text>
      </ValueSettle>,
    );
    view.rerender(
      <ValueSettle value="b">
        <Text>b</Text>
      </ValueSettle>,
    );
    expect(screen.getByText('b')).toBeOnTheScreen();
  });
});

describe('stackAnimation', () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it('is none under Reduce Motion', () => {
    expect(stackAnimation(true)).toBe('none');
  });

  it('slides in from the right on Android and uses the system push on iOS', () => {
    Platform.OS = 'android';
    expect(stackAnimation(false)).toBe('ios_from_right');
    Platform.OS = 'ios';
    expect(stackAnimation(false)).toBe('default');
  });
});

describe('under StillMotion (the capture screen)', () => {
  function renderStill(children: ReactNode) {
    return render(<StillMotion.Provider value>{children}</StillMotion.Provider>);
  }

  it('gives Reveal and Settle no entering, exiting or layout animation', () => {
    renderStill(
      <>
        <Reveal settle>
          <Text>revealed</Text>
        </Reveal>
        <Settle>
          <Text>settled</Text>
        </Settle>
      </>,
    );
    for (const view of screen.UNSAFE_getAllByType(Animated.View)) {
      expect(view.props.entering).toBeUndefined();
      expect(view.props.exiting).toBeUndefined();
      expect(view.props.layout).toBeUndefined();
    }
  });

  it('adds no opacity or transform to ValueSettle', () => {
    renderStill(
      <ValueSettle value={1}>
        <Text>one</Text>
      </ValueSettle>,
    );
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/"(transform|opacity)"/);
  });

  it('gives QualityChip no entering animation', () => {
    renderStill(<QualityChip level={0.9} />);
    const chip = screen.UNSAFE_getAllByType(Animated.View).find((view) => view.props.accessible);
    expect(chip).toBeDefined();
    expect(chip?.props.entering).toBeUndefined();
  });

  it('still animates Reveal outside the capture screen, without a layout slide by default', () => {
    render(
      <Reveal>
        <Text>revealed</Text>
      </Reveal>,
    );
    const [view] = screen.UNSAFE_getAllByType(Animated.View);
    expect(view?.props.entering).toBeDefined();
    expect(view?.props.layout).toBeUndefined();
  });
});

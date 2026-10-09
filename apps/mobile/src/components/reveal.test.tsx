import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { stackAnimation } from '@/theme/motion';

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

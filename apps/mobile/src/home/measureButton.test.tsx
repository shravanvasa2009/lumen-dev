import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import tokens from '@/theme/tokens.json';

import { MeasureButton, measureLayout } from './MeasureButton';

// 320 is the regular size, the approved mockup; 164 is the 360 x 640 size.
describe('Measure button layout', () => {
  it.each([320, 164])('keeps the English label and mode line on the near-opaque fill at size %s', (size) => {
    const { cornerFromCenter, readableReach } = measureLayout(size, 1);
    expect(cornerFromCenter).toBeLessThanOrEqual(readableReach);
  });

  it('keeps a Spanish mode line that wraps to two lines on the near-opaque fill on the regular size', () => {
    const { cornerFromCenter, readableReach } = measureLayout(320, 2);
    expect(cornerFromCenter).toBeLessThanOrEqual(readableReach);
  });

  it('sets the label and mode line in the mockup sizes, not caption size', () => {
    expect(measureLayout(320, 1).text).toMatchObject({ label: 40, mode: 17 });
    expect(measureLayout(164, 1).text).toMatchObject({ label: 26, mode: 14 });
  });
});

describe('Measure button look', () => {
  it.each(['light', 'dark'] as const)('has a core colour token in %s', (theme) => {
    expect(tokens[theme].measureCore).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('draws one gradient disc and 90 timer ticks, and the theme text colour on the label', () => {
    const screen = render(
      <MeasureButton label="Measure" modeLabel="Full, 90 s" size={320} onPress={() => {}} />,
    );
    const themeTextColors = [tokens.light.text, tokens.dark.text];
    expect(themeTextColors).toContain(StyleSheet.flatten(screen.getByText('Measure').props.style).color);
    expect(JSON.stringify(screen.toJSON()).match(/RNSVGLine/g)).toHaveLength(90);
  });
});

import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';

import { SignalMeter, SignalScale } from './practiceParts';

import '@/i18n';

describe('SignalMeter', () => {
  it('draws no marker without a level', () => {
    render(<SignalMeter />);
    expect(screen.queryByTestId('signal-marker', { includeHiddenElements: true })).toBeNull();
  });

  it('places the marker by level and keeps it inside the bar', () => {
    const { rerender } = render(<SignalMeter level={0.5} />);
    expect(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.cx).toBe('50%');
    rerender(<SignalMeter level={7} />);
    expect(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.cx).toBe('96%');
    rerender(<SignalMeter level={-1} />);
    expect(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.cx).toBe('4%');
  });
});

describe('SignalScale', () => {
  it('labels Weak, OK and Strong', () => {
    render(<SignalScale />);
    for (const key of ['signal.weak', 'signal.ok', 'signal.strong'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
  });

  it('emphasises the label under the marker, and none without a level', () => {
    const weight = (key: 'signal.weak' | 'signal.ok' | 'signal.strong') =>
      StyleSheet.flatten(screen.getByText(en[key]).props.style).fontWeight;
    const { rerender } = render(<SignalScale />);
    expect(weight('signal.strong')).not.toBe('600');
    rerender(<SignalScale level={0.1} />);
    expect([weight('signal.weak'), weight('signal.strong')]).toEqual(['600', '400']);
    rerender(<SignalScale level={0.9} />);
    expect([weight('signal.weak'), weight('signal.strong')]).toEqual(['400', '600']);
  });
});

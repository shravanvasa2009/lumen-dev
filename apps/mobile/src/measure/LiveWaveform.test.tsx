import { fireEvent, render, screen } from '@testing-library/react-native';

import { LiveWaveform } from './LiveWaveform';

const beats = Array.from({ length: 40 }, (_, index) => Math.sin(index / 3));

describe('LiveWaveform', () => {
  it('draws a curve path for each trace once the card has a width', () => {
    render(<LiveWaveform pulse={beats} red={beats} />);
    fireEvent(screen.getByTestId('live-waveform-card'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 200 } },
    });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('live-waveform-raw', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('draws a flat line while there are fewer than two values', () => {
    render(<LiveWaveform pulse={[]} red={[0.5]} />);
    expect(screen.queryByTestId('live-waveform', { includeHiddenElements: true })).toBeNull();
  });
});

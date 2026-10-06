import { act, render, renderHook, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { View } from 'react-native';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';

import es from '@/i18n/es.json';
import { useTheme } from '@/theme';

import { FingerPreview, SignalMeter, SignalScale } from './practiceParts';

import '@/i18n';

const mockNative: { view: unknown } = { view: null };
jest.mock('../../modules/lumen-capture/src/LumenPreviewView', () => ({
  get LumenPreviewView() {
    return mockNative.view;
  },
}));

describe('FingerPreview', () => {
  const ringColour = (colour: string) =>
    screen.UNSAFE_getAllByType(View).some((node) => {
      const style = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
      return style.borderWidth === 4 && style.borderColor === colour;
    });

  afterEach(() => {
    mockNative.view = null;
  });

  it('shows the glow, with no chip or caption, where there is no native view', () => {
    render(<FingerPreview detected cameraRunning coaching={false} />);
    expect(screen.queryByText(en['capture.liveBadge'])).toBeNull();
    expect(screen.queryByText(en['capture.liveView'])).toBeNull();
  });

  it('shows the glow while no capture runs even when the native view exists', () => {
    mockNative.view = View;
    render(<FingerPreview detected cameraRunning={false} coaching={false} />);
    expect(screen.queryByText(en['capture.liveBadge'])).toBeNull();
  });

  it('shows the native view with its chip, caption and one spoken label while a capture runs', () => {
    mockNative.view = View;
    render(<FingerPreview detected cameraRunning coaching={false} size={150} />);
    expect(screen.getByText(en['capture.liveBadge'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.liveView'])).toBeOnTheScreen();
    expect(screen.getByLabelText(en['capture.liveViewA11y'])).toBeOnTheScreen();
  });

  it('rings in accent while checks pass and in flag while a coaching line shows', () => {
    mockNative.view = View;
    const { result: theme } = renderHook(() => useTheme());
    const { rerender } = render(<FingerPreview detected cameraRunning coaching={false} />);
    expect(ringColour(theme.current.colors.accent)).toBe(true);
    rerender(<FingerPreview detected cameraRunning coaching />);
    expect(ringColour(theme.current.colors.flag)).toBe(true);
  });

  it('is in Spanish too', async () => {
    mockNative.view = View;
    await act(() => i18next.changeLanguage('es'));
    try {
      render(<FingerPreview detected cameraRunning coaching={false} />);
      expect(screen.getByText(es['capture.liveBadge'])).toBeOnTheScreen();
      expect(screen.getByText(es['capture.liveView'])).toBeOnTheScreen();
      expect(screen.getByLabelText(es['capture.liveViewA11y'])).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });
});

describe('SignalMeter', () => {
  const markerLeft = () =>
    StyleSheet.flatten(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.style).left;

  it('draws no marker without a level', () => {
    render(<SignalMeter />);
    expect(screen.queryByTestId('signal-marker', { includeHiddenElements: true })).toBeNull();
  });

  it('places the marker by level and keeps it inside the bar', () => {
    const { rerender } = render(<SignalMeter level={0.5} />);
    expect(markerLeft()).toBe('50%');
    rerender(<SignalMeter level={7} />);
    expect(markerLeft()).toBe('96%');
    rerender(<SignalMeter level={-1} />);
    expect(markerLeft()).toBe('4%');
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

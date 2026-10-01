import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import tokens from '@/theme/tokens.json';

import { AppText } from './AppText';
import { Button } from './Button';
import { ListRow } from './ListRow';
import { Screen } from './Screen';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('components in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('Screen pads by 20 and paints the themed background', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen>
          <AppText>inside</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    let node = screen.getByText('inside').parent;
    while (node && StyleSheet.flatten(node.props.style)?.padding === undefined) node = node.parent;
    const style = StyleSheet.flatten(node?.props.style);
    expect(style).toMatchObject({ backgroundColor: colors.bg });
    expect(style.padding).toBe(20);
  });

  it('AppText applies the type scale and tone colour', () => {
    render(
      <>
        <AppText variant="display">big</AppText>
        <AppText variant="caption" tone="textDim">
          small
        </AppText>
      </>,
    );
    expect(StyleSheet.flatten(screen.getByText('big').props.style)).toMatchObject({
      color: colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
    });
    expect(StyleSheet.flatten(screen.getByText('small').props.style)).toMatchObject({
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 18,
    });
  });

  it('primary Button is 52 tall with the accent fill and calls onPress', () => {
    const onPress = jest.fn();
    render(<Button label="Start" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Start' });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minHeight: 52,
      backgroundColor: colors.accentFill,
    });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('secondary Button keeps a 44 point target and an outline', () => {
    render(<Button label="Later" variant="secondary" onPress={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Later' }).props.style)).toMatchObject({
      minHeight: 44,
      borderColor: colors.line2,
    });
  });

  it('critical Button and critical text use the emergency red of the theme', () => {
    render(
      <>
        <Button label="Call" variant="critical" onPress={jest.fn()} />
        <AppText tone="criticalText">Alert</AppText>
      </>,
    );
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Call' }).props.style)).toMatchObject({
      minHeight: 52,
      backgroundColor: colors.criticalFill,
    });
    expect(StyleSheet.flatten(screen.getByText('Alert').props.style)).toMatchObject({
      color: colors.criticalText,
    });
  });

  it('a disabled Button does not call onPress', () => {
    const onPress = jest.fn();
    render(<Button label="Wait" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole('button', { name: 'Wait' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ListRow shows its text and is a button only when pressable', () => {
    const onPress = jest.fn();
    render(
      <>
        <ListRow title="Phone" subtitle="Rated Full" onPress={onPress} />
        <ListRow title="Static" />
      </>,
    );
    expect(screen.getByText('Rated Full')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: /Phone/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

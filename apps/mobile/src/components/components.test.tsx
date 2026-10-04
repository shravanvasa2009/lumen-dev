import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { focusedNavHeader } from '@/testing/navHeader';
import tokens from '@/theme/tokens.json';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { ListRow } from './ListRow';
import { RouteShell } from './RouteShell';
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

// The nearest ancestor that carries layout or box styling, skipping the text's own style.
function styleAround(text: string) {
  let node = screen.getByText(text).parent;
  const isOwnStyle = (style: object | undefined) => !style || 'color' in style;
  while (node && isOwnStyle(StyleSheet.flatten(node.props.style))) node = node.parent;
  return StyleSheet.flatten(node?.props.style);
}

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

  it('Screen counts the top inset only when headerless', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen>
          <AppText>with header</AppText>
        </Screen>
        <Screen headerless>
          <AppText>no header</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    const edgesOf = (text: string) => {
      let node = screen.getByText(text).parent;
      while (node && node.props.edges === undefined) node = node.parent;
      return node?.props.edges;
    };
    expect(edgesOf('with header')).toMatchObject({ top: 'off' });
    expect(edgesOf('no header')).toMatchObject({ top: 'additive' });
  });

  it('Screen renders the footer after the body', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen footer={<Button label="Go" onPress={jest.fn()} />}>
          <AppText>body</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.getByRole('button', { name: 'Go' })).toBeOnTheScreen();
  });

  it('Card paints the surface with a line border and the card radius', () => {
    render(
      <Card>
        <AppText>boxed</AppText>
      </Card>,
    );
    expect(styleAround('boxed')).toMatchObject({
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderRadius: tokens.radius.card,
    });
  });

  it('ListRow draws a divider unless it is the last row of a group', () => {
    render(
      <>
        <ListRow title="First" onPress={jest.fn()} />
        <ListRow title="Final" last onPress={jest.fn()} />
      </>,
    );
    const dividerOf = (name: string) =>
      StyleSheet.flatten(screen.getByRole('button', { name }).props.style).borderBottomWidth;
    expect(dividerOf('First')).toBeGreaterThan(0);
    expect(dividerOf('Final')).toBe(0);
  });

  it.each<IconName>([
    'home',
    'trends',
    'learn',
    'settings',
    'chevron',
    'check',
    'close',
    'warning',
    'share',
    'noSignal',
    'hint',
    'rhythm',
    'breath',
    'drop',
    'extraBeat',
    'warm',
    'finger',
    'elbow',
    'cup',
    'lens',
    'phone',
    'pulse',
    'clock',
    'bars',
    'drop',
    'standing',
    'heart',
  ])('Icon %s draws strokes in the colour it is given', (name) => {
    render(<Icon name={name} size={24} color={colors.accent} />);
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn).toContain('RNSVGPath');
    // react-native-svg serialises a colour as opaque ARGB.
    const opaqueArgb = Number.parseInt(colors.accent.slice(1), 16) + 0xff000000;
    expect(drawn).toContain(`"stroke":{"type":0,"payload":${opaqueArgb}}`);
  });

  it('the warning triangle fills with its colour and draws the exclamation in the mark colour', () => {
    render(<Icon name="warning" size={72} color={colors.criticalText} mark={colors.bg} />);
    const drawn = JSON.stringify(screen.toJSON());
    const opaqueArgb = (hex: string) => Number.parseInt(hex.slice(1), 16) + 0xff000000;
    expect(drawn).toContain(`"fill":{"type":0,"payload":${opaqueArgb(colors.criticalText)}}`);
    expect(drawn).toContain(`"stroke":{"type":0,"payload":${opaqueArgb(colors.bg)}}`);
    expect(drawn).toContain('no-hide-descendants');
  });

  it('ListRow shows a chevron only when asked', () => {
    const { unmount } = render(<ListRow title="Goes" chevron onPress={jest.fn()} />);
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGSvgView');
    unmount();
    render(<ListRow title="Stays" onPress={jest.fn()} />);
    expect(JSON.stringify(screen.toJSON())).not.toContain('RNSVGSvgView');
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

  it('link Button has no fill or outline and reads in the accent colour', () => {
    render(<Button label="Not now" variant="link" onPress={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Not now' }).props.style)).toMatchObject({
      minHeight: 44,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    });
    expect(StyleSheet.flatten(screen.getByText('Not now').props.style)).toMatchObject({
      color: colors.accent,
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

  it('ListRow dims a disabled row and ignores presses', () => {
    const onPress = jest.fn();
    render(<ListRow title="Coming soon" disabled onPress={onPress} />);
    const row = screen.getByRole('button', { name: /Coming soon/ });
    fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
    expect(row).toBeDisabled();
    expect(StyleSheet.flatten(row.props.style).opacity).toBeLessThan(1);
  });

  it('RouteShell puts its trailing control at the right of the nav bar', () => {
    renderRouter({
      _layout: () => <Stack />,
      index: () => <RouteShell title="Lab" trailing={<Text>DEV</Text>} />,
    });
    expect(focusedNavHeader()).toMatchObject({ title: 'Lab' });
    expect(screen.queryByRole('header', { name: 'Lab' })).toBeNull();
    let subview = screen.getByText('DEV').parent;
    while (subview && String(subview.type) !== 'RNSScreenStackHeaderSubview') subview = subview.parent;
    expect(subview?.props.type).toBe('right');
  });

  it('RouteShell keeps the trailing control beside the body title without a nav bar', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <RouteShell tabRoot title="Learn" trailing={<Text>EN</Text>} />
      </SafeAreaProvider>,
    );
    let row = screen.getByRole('header', { name: 'Learn' }).parent;
    while (row && StyleSheet.flatten(row.props.style)?.flexDirection !== 'row') row = row.parent;
    expect(row).not.toBeNull();
    expect(within(row!).getByText('EN')).toBeOnTheScreen();
  });
});

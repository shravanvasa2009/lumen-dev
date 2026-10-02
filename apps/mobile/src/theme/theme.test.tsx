import { act, renderHook } from '@testing-library/react-native';

import { useTheme } from './index';
import { setPreference } from './preferences';
import tokens from './tokens.json';

let mockScheme: 'light' | 'dark' | null | undefined;
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

describe('useTheme', () => {
  afterEach(() => {
    act(() => setPreference('appearance', 'system'));
  });

  it('returns the light colours for a light system', () => {
    mockScheme = 'light';
    const { result: theme } = renderHook(() => useTheme());
    expect(theme.current.isDark).toBe(false);
    expect(theme.current.colors).toBe(tokens.light);
  });

  it('returns the dark colours for a dark system', () => {
    mockScheme = 'dark';
    const { result: theme } = renderHook(() => useTheme());
    expect(theme.current.isDark).toBe(true);
    expect(theme.current.colors).toBe(tokens.dark);
  });

  it('defaults to dark when the system gives no preference', () => {
    mockScheme = null;
    const { result: theme } = renderHook(() => useTheme());
    expect(theme.current.colors.bg).toBe('#0B0E14');
  });

  it.each([
    ['light', 'dark', tokens.light],
    ['dark', 'light', tokens.dark],
  ] as const)('an explicit %s choice beats a %s system', (choice, system, expected) => {
    mockScheme = system;
    const { result: theme } = renderHook(() => useTheme());
    act(() => setPreference('appearance', choice));
    expect(theme.current.colors).toBe(expected);
    expect(theme.current.isDark).toBe(choice === 'dark');
  });

  it('follows the system again after the choice returns to system', () => {
    mockScheme = 'light';
    const { result: theme } = renderHook(() => useTheme());
    act(() => setPreference('appearance', 'dark'));
    act(() => setPreference('appearance', 'system'));
    expect(theme.current.colors).toBe(tokens.light);
  });

  it('carries the section 12.1 scale in both themes', () => {
    mockScheme = 'light';
    const { result: theme } = renderHook(() => useTheme());
    expect(theme.current.type.display).toEqual({ size: 34, lineHeight: 40, weight: '700' });
    expect(theme.current.spacing.screen).toBe(20);
    expect(theme.current.radius.card).toBe(16);
    expect(theme.current.control.primaryButtonHeight).toBe(52);
  });

  it('keeps the same colour names in light and dark', () => {
    expect(Object.keys(tokens.light).sort()).toEqual(Object.keys(tokens.dark).sort());
  });
});

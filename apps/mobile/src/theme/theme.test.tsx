import { renderHook } from '@testing-library/react-native';

import { useTheme } from './index';
import tokens from './tokens.json';

let mockScheme: 'light' | 'dark' | null | undefined;
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

describe('useTheme', () => {
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

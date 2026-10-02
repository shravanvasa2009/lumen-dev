import { useColorScheme } from 'react-native';

import { usePreferences } from './preferences';
import tokens from './tokens.json';

type TypeScale = Record<
  keyof typeof tokens.type,
  { size: number; lineHeight: number; weight: '400' | '600' | '700' }
>;

// JSON imports widen weights to string; React Native's fontWeight accepts only its own literals.
const typeScale = tokens.type as TypeScale;

// An explicit Appearance choice beats the system; dark is the default whenever neither says light.
export function useTheme() {
  const { appearance } = usePreferences();
  const systemScheme = useColorScheme();
  const isLight = (appearance === 'system' ? systemScheme : appearance) === 'light';
  return {
    isDark: !isLight,
    colors: isLight ? tokens.light : tokens.dark,
    type: typeScale,
    spacing: tokens.spacing,
    radius: tokens.radius,
    control: tokens.control,
  };
}

import { useColorScheme } from 'react-native';

import tokens from './tokens.json';

type TypeScale = Record<
  keyof typeof tokens.type,
  { size: number; lineHeight: number; weight: '400' | '600' | '700' }
>;

// JSON imports widen weights to string; React Native's fontWeight accepts only its own literals.
const typeScale = tokens.type as TypeScale;

// Dark is the default whenever the system gives no explicit light preference.
export function useTheme() {
  const isLight = useColorScheme() === 'light';
  return {
    isDark: !isLight,
    colors: isLight ? tokens.light : tokens.dark,
    type: typeScale,
    spacing: tokens.spacing,
    radius: tokens.radius,
    control: tokens.control,
  };
}

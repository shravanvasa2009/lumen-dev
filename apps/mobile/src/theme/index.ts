import { useColorScheme } from 'react-native';

import tokens from './tokens.json';

// Dark is the default whenever the system gives no explicit light preference.
export function useTheme() {
  const isLight = useColorScheme() === 'light';
  return {
    isDark: !isLight,
    colors: isLight ? tokens.light : tokens.dark,
    type: tokens.type,
    spacing: tokens.spacing,
    radius: tokens.radius,
    control: tokens.control,
  };
}

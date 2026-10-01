import type { ColorSchemeName } from 'react-native';

import tokens from './tokens.json';

export type Theme = (typeof tokens)['dark'];

// Dark is the default whenever the system gives no explicit light preference.
export function themeFor(scheme: ColorSchemeName): Theme {
  return scheme === 'light' ? tokens.light : tokens.dark;
}

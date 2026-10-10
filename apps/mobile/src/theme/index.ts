import type { ViewStyle } from 'react-native';
import { useColorScheme } from 'react-native';

import { usePreferences } from './preferences';
import tokens from './tokens.json';

type TypeStyle = { size: number; lineHeight: number; weight: '400' | '600' | '700'; letterSpacing?: number };
type TypeScale = Record<keyof typeof tokens.type, TypeStyle>;

// JSON imports widen weights to string; React Native's fontWeight accepts only its own literals.
const typeScale = tokens.type as TypeScale;

// Cards sit on a grouped background in light mode and carry a soft lift; in dark mode surfaces are separated by
// colour alone, so the shadow is dropped.
function shadowStyle(
  { offsetY, blur, opacity, elevation }: (typeof tokens.shadow)['raised'],
  isLight: boolean,
): ViewStyle {
  return isLight
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: offsetY },
        shadowRadius: blur / 2,
        shadowOpacity: opacity,
        elevation,
      }
    : {};
}

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
    gradients: tokens.gradients,
    shadow: {
      raised: shadowStyle(tokens.shadow.raised, isLight),
      floating: shadowStyle(tokens.shadow.floating, isLight),
    },
  };
}

import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/theme';

type AppTextProps = TextProps & {
  variant?:
    | 'display'
    | 'title'
    | 'title3'
    | 'headline'
    | 'body'
    | 'subheadline'
    | 'caption'
    | 'caption1'
    | 'caption2'
    | 'vitalHero'
    | 'vitalXL'
    | 'vitalL'
    | 'vitalM'
    | 'vitalS';
  tone?: 'text' | 'textDim' | 'textFaint' | 'accent' | 'criticalText' | 'alertText';
};

// Vitals change every second, so their digits keep a fixed width and the number does not jitter.
const VITAL_VARIANTS = new Set(['vitalHero', 'vitalXL', 'vitalL', 'vitalM', 'vitalS']);

export function AppText({ variant = 'body', tone = 'text', style, ...textProps }: AppTextProps) {
  const { colors, type } = useTheme();
  const scale = type[variant];
  return (
    <Text
      {...textProps}
      style={[
        {
          color: colors[tone],
          fontSize: scale.size,
          lineHeight: scale.lineHeight,
          fontWeight: scale.weight,
          ...(scale.letterSpacing === undefined ? null : { letterSpacing: scale.letterSpacing }),
          ...(VITAL_VARIANTS.has(variant) ? { fontVariant: ['tabular-nums' as const] } : null),
        },
        style,
      ]}
    />
  );
}

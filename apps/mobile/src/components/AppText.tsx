import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/theme';

type AppTextProps = TextProps & {
  variant?: 'display' | 'title' | 'headline' | 'body' | 'caption';
  tone?: 'text' | 'textDim' | 'textFaint' | 'accent' | 'criticalText';
};

export function AppText({ variant = 'body', tone = 'text', style, ...textProps }: AppTextProps) {
  const { colors, type } = useTheme();
  const scale = type[variant];
  return (
    <Text
      {...textProps}
      style={[
        { color: colors[tone], fontSize: scale.size, lineHeight: scale.lineHeight, fontWeight: scale.weight },
        style,
      ]}
    />
  );
}

import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/theme';

import { paper } from './paper';

type PaperTextProps = TextProps & {
  variant?: 'headline' | 'body' | 'caption';
  tone?: 'text' | 'textDim' | 'flag';
  bold?: boolean;
};

export function PaperText({
  variant = 'body',
  tone = 'text',
  bold = false,
  style,
  ...textProps
}: PaperTextProps) {
  const { type } = useTheme();
  const scale = type[variant];
  return (
    <Text
      {...textProps}
      style={[
        {
          color: paper[tone],
          fontSize: scale.size,
          lineHeight: scale.lineHeight,
          fontWeight: bold ? '700' : scale.weight,
        },
        style,
      ]}
    />
  );
}

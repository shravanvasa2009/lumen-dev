import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

type IconLineProps = {
  icon: ComponentProps<typeof Icon>['name'];
  tone?: 'accent' | 'textDim';
  children: string;
};

// A short line of text led by an icon, for lists inside a padded card.
export function IconLine({ icon, tone = 'accent', children }: IconLineProps) {
  const { colors, spacing, control } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <View style={{ height: 23, justifyContent: 'center' }}>
        <Icon name={icon} size={control.chevronSize} color={colors[tone]} />
      </View>
      <AppText style={{ flex: 1 }}>{children}</AppText>
    </View>
  );
}

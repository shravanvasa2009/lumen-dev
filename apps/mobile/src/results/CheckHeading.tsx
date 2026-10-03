import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

type CheckHeadingProps = { icon: IconName; name?: string; label: string };

// "AFib · Heart rhythm": the check's icon and short name, then the dimmer description.
export function CheckHeading({ icon, name, label }: CheckHeadingProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 }}>
      <Icon name={icon} size={20} color={colors.accent} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexShrink: 1 }}>
        {name ? (
          <>
            <AppText variant="headline">{name}</AppText>
            <AppText tone="textDim">·</AppText>
          </>
        ) : null}
        <AppText tone="textDim">{label}</AppText>
      </View>
    </View>
  );
}

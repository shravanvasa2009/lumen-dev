import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

type CheckHeadingProps = { icon: IconName; name?: string; label: string };

// "AFib · Heart rhythm": the check's icon and short name, then the dimmer description.
// It grows from its natural width (not flex: 1's zero basis), so a wrapping row moves badges beside it to the
// next line instead of squeezing the label to a letter-wide column.
export function CheckHeading({ icon, name, label }: CheckHeadingProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexGrow: 1, flexShrink: 1 }}>
      <Icon name={icon} size={20} color={colors.accent} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexShrink: 1 }}>
        {name ? (
          <>
            <AppText variant="headline">{name}</AppText>
            <AppText tone="textDim">·</AppText>
          </>
        ) : null}
        <AppText tone="textDim" style={{ flexShrink: 1 }}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

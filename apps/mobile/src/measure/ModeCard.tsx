import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

type ModeCardProps = {
  icon: IconName;
  title: string;
  body: string;
  duration: string;
  recommended?: string;
  selected: boolean;
  // Present when the mode cannot start; the row then ignores presses and shows this reason.
  unavailable?: string;
  // The reason is a rating lock, so the row shows a lock beside it.
  locked?: boolean;
  last: boolean;
  onSelect?: () => void;
};

// One row of the mode list: a radio choice that Continue then starts.
export function ModeCard({
  icon,
  title,
  body,
  duration,
  recommended,
  selected,
  unavailable,
  locked,
  last,
  onSelect,
}: ModeCardProps) {
  const { colors, spacing, radius, control } = useTheme();
  const tint = unavailable ? colors.textDim : colors.accent;
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={unavailable}
      accessibilityState={{ checked: selected, disabled: Boolean(unavailable) }}
      disabled={Boolean(unavailable)}
      onPress={onSelect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: control.minTarget,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
        opacity: unavailable ? 0.7 : 1,
      }}
    >
      <Icon name={icon} size={22} color={tint} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <AppText tone={unavailable ? 'textDim' : 'text'}>{title}</AppText>
          {recommended ? (
            <View
              style={{
                backgroundColor: colors.badgeCheckedBg,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              }}
            >
              <AppText variant="caption" style={{ fontWeight: '600', color: colors.badgeCheckedFg }}>
                {recommended}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="textDim">
          {body}
        </AppText>
        {unavailable ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            {locked ? <Icon name="lock" size={16} color={colors.textFaint} /> : null}
            <AppText variant="caption" tone="textFaint" style={{ flex: 1 }}>
              {unavailable}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="caption" tone="textDim">
        {duration}
      </AppText>
      {selected ? <Icon name="check" size={control.chevronSize} color={colors.accent} /> : null}
    </PressableScale>
  );
}

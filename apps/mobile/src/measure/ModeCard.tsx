import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

type ModeCardProps = {
  title: string;
  body: string;
  duration: string;
  recommended?: string;
  // Present when the mode cannot start; the card then ignores presses and shows this reason.
  unavailable?: string;
  onPress?: () => void;
};

export function ModeCard({ title, body, duration, recommended, unavailable, onPress }: ModeCardProps) {
  const { colors, spacing, radius } = useTheme();
  const pill = (label: string, tone: 'accent' | 'textDim') => (
    <View
      style={{
        backgroundColor: colors.surface2,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
      }}
    >
      <AppText variant="caption" tone={tone} style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(unavailable) }}
      disabled={Boolean(unavailable)}
      onPress={onPress}
      style={{ opacity: unavailable ? 0.6 : 1 }}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="headline" style={{ flex: 1 }}>
            {title}
          </AppText>
          {recommended ? pill(recommended, 'accent') : null}
          {pill(duration, 'textDim')}
        </View>
        <AppText tone="textDim">{body}</AppText>
        {unavailable ? (
          <AppText variant="caption" tone="textFaint">
            {unavailable}
          </AppText>
        ) : (
          <Icon name="finger" size={24} color={colors.pulse} />
        )}
      </Card>
    </Pressable>
  );
}

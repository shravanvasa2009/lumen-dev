import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { Lesson } from './lessons';

type LessonRowProps = {
  title: string;
  subtitle: string;
  tone: Lesson['tone'];
  last: boolean;
  onPress: () => void;
};

// No theme token fits: radius.card is 16 and the control sizes are 44 and 52, and the mockup tile is 48 with
// a 12 corner.
const TILE_SIZE = 48;
const TILE_RADIUS = 12;

// Tile colours come from theme tokens only; red stays reserved for the emergency screen (SAFE-1).
export function LessonRow({ title, subtitle, tone, last, onPress }: LessonRowProps) {
  const { colors, spacing, control } = useTheme();
  const tileFill = { accent: colors.accentFill, flag: colors.flag, public: colors.badgePublicFg }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.row,
        {
          minHeight: control.minTarget,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
          borderBottomColor: colors.line,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: tileFill }]}>
        <Icon name="learn" size={control.chevronSize + 4} color={colors.bg} />
      </View>
      <View style={styles.text}>
        <AppText>{title}</AppText>
        <AppText variant="caption" tone="textDim">
          {subtitle}
        </AppText>
      </View>
      <Icon name="chevron" size={control.chevronSize} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: TILE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});

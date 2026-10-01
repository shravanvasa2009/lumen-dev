import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

type ListRowProps = {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  // The last row of a grouped card has no divider under it.
  last?: boolean;
  onPress?: () => void;
};

export function ListRow({ title, subtitle, trailing, last = false, onPress }: ListRowProps) {
  const { colors, spacing, control } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
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
      <View style={styles.text}>
        <AppText>{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="textDim">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});

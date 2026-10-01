import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

type ListRowProps = {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  last?: boolean;
  chevron?: boolean;
  onPress?: () => void;
};

export function ListRow({ title, subtitle, trailing, last = false, chevron = false, onPress }: ListRowProps) {
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
      {chevron ? <Icon name="chevron" size={control.chevronSize} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});

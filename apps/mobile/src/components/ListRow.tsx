import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

type ListRowProps = {
  title: string;
  leading?: ReactNode;
  subtitle?: string;
  trailing?: ReactNode;
  last?: boolean;
  chevron?: boolean;
  // A row that is announced but ignores presses while its action runs.
  disabled?: boolean;
  // Set on a row that opens and closes the content below it, so a screen reader hears its state.
  expanded?: boolean;
  onPress?: () => void;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  last = false,
  chevron = false,
  disabled = false,
  expanded,
  onPress,
}: ListRowProps) {
  const { colors, spacing, control } = useTheme();
  return (
    <PressableScale
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress || disabled}
      accessibilityState={{ disabled, expanded }}
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
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {leading}
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
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});

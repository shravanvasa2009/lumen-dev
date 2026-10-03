import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  // Headerless screens have no native header, so the status-bar inset must come from here.
  headerless?: boolean;
  footer?: ReactNode;
  // Tab screens on a small phone: the tab bar already sits below, so the bottom inset and padding go.
  tight?: boolean;
};

export function Screen({ children, headerless = false, footer, tight = false }: ScreenProps) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={
        headerless
          ? ['top', 'left', 'right', ...(tight ? [] : (['bottom'] as const))]
          : ['left', 'right', 'bottom']
      }
      style={[
        styles.screen,
        {
          backgroundColor: colors.bg,
          padding: spacing.screen,
          ...(tight ? { paddingTop: spacing.sm, paddingBottom: 0 } : null),
        },
      ]}
    >
      <View style={styles.body}>{children}</View>
      {footer ? <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
});

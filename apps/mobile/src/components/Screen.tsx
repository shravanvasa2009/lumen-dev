import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  // Headerless screens have no native header, so the status-bar inset must come from here.
  headerless?: boolean;
  footer?: ReactNode;
  // Tab screens that need the room: the tab bar already sits below, so the bottom inset and padding go.
  tight?: boolean;
  // Tab roots keep their normal padding, but the tab bar already covers the bottom inset, so only that goes.
  aboveTabBar?: boolean;
};

export function Screen({
  children,
  headerless = false,
  footer,
  tight = false,
  aboveTabBar = false,
}: ScreenProps) {
  const { colors, spacing } = useTheme();
  const belowIsTabBar = tight || aboveTabBar;
  return (
    <SafeAreaView
      edges={
        headerless
          ? ['top', 'left', 'right', ...(belowIsTabBar ? [] : (['bottom'] as const))]
          : ['left', 'right', 'bottom']
      }
      style={[
        styles.screen,
        {
          backgroundColor: colors.bg,
          padding: spacing.screen,
          ...(tight ? { paddingTop: spacing.sm } : null),
          ...(belowIsTabBar ? { paddingBottom: 0 } : null),
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

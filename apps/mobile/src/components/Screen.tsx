import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  // Headerless screens have no native header, so the status-bar inset must come from here.
  headerless?: boolean;
  footer?: ReactNode;
  centered?: boolean;
};

export function Screen({ children, headerless = false, footer, centered = false }: ScreenProps) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={headerless ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: colors.bg, padding: spacing.screen }]}
    >
      <View style={[styles.body, centered && styles.centered]}>{children}</View>
      {footer ? <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  centered: { justifyContent: 'center' },
});

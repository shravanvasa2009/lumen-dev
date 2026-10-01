import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

// Flush cards hold grouped rows that bring their own padding and dividers.
export function Card({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
        overflow: 'hidden',
        padding: flush ? 0 : spacing.lg,
        gap: spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

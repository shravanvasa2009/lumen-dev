import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

// Flush cards hold grouped rows that bring their own padding and dividers. Dense cards are for small screens.
export function Card({
  children,
  flush = false,
  dense = false,
}: {
  children: ReactNode;
  flush?: boolean;
  dense?: boolean;
}) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
        overflow: 'hidden',
        padding: flush ? 0 : dense ? spacing.sm : spacing.lg,
        gap: dense ? 0 : spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

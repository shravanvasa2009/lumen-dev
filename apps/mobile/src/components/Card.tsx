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
  const { colors, radius, spacing, shadow } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.sheet,
        // A shadow is clipped by overflow, so only flush cards (whose rows must stay inside the corners) clip.
        ...(flush ? { overflow: 'hidden' as const } : shadow.raised),
        padding: flush ? 0 : dense ? spacing.sm : spacing.lg,
        gap: dense ? 0 : spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

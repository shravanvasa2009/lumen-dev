import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

export function GroupLabel({ children }: { children: string }) {
  const { spacing } = useTheme();
  return (
    <AppText
      variant="caption"
      tone="textDim"
      accessibilityRole="header"
      style={{ paddingHorizontal: spacing.lg, marginBottom: -spacing.sm }}
    >
      {children}
    </AppText>
  );
}

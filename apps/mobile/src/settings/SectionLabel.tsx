import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

// The small heading above a grouped card. It sits one gutter further in than the card, as in the mockups.
export function SectionLabel({ children }: { children: string }) {
  const { spacing } = useTheme();
  return (
    <AppText
      variant="caption"
      tone="textDim"
      accessibilityRole="header"
      style={{ paddingHorizontal: spacing.lg }}
    >
      {children}
    </AppText>
  );
}

import { AppText } from '@/components/AppText';

export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText
      variant="caption"
      tone="textFaint"
      accessibilityRole="header"
      style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' }}
    >
      {children}
    </AppText>
  );
}

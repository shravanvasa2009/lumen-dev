import { AppText } from '@/components/AppText';

const SIZE = 20;
const LINE_HEIGHT = 25;

export function SectionTitle({ children }: { children: string }) {
  return (
    <AppText
      variant="headline"
      accessibilityRole="header"
      style={{ fontSize: SIZE, lineHeight: LINE_HEIGHT }}
    >
      {children}
    </AppText>
  );
}

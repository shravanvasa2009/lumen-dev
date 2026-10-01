import { AppText } from './AppText';

export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText
      variant="caption"
      tone="textDim"
      style={{ fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' }}
    >
      {children}
    </AppText>
  );
}

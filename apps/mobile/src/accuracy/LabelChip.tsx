import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

type LabelChipProps = { word: string; fg: string; bg: string };

// The key to the labels; the real per-check badges are EvidenceBadge, so this carries no evidence test id.
export function LabelChip({ word, fg, bg }: LabelChipProps) {
  const { radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 3,
      }}
    >
      <AppText variant="caption" style={{ color: fg, fontWeight: '600' }}>
        {word}
      </AppText>
    </View>
  );
}

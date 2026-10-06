import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { type EvidenceKey, evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { AppText } from './AppText';

// The label comes from the evidence reader alone; basicAnalysis only lowers it to Experimental (§11.10).
export function EvidenceBadge({
  metric,
  compact = false,
  basicAnalysis = false,
}: {
  metric: EvidenceKey;
  compact?: boolean;
  basicAnalysis?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const label = basicAnalysis ? 'experimental' : evidenceFor(metric).label;
  const look = {
    checked: { fg: colors.badgeCheckedFg, bg: colors.badgeCheckedBg, word: t('evidence.checked') },
    'public-data': { fg: colors.badgePublicFg, bg: colors.badgePublicBg, word: t('evidence.publicData') },
    experimental: {
      fg: colors.badgeExperimentalFg,
      bg: colors.badgeExperimentalBg,
      word: t('evidence.experimental'),
    },
  }[label];
  return (
    <View
      testID="evidence-badge"
      accessibilityLabel={look.word}
      style={{
        alignSelf: 'flex-start',
        backgroundColor: look.bg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: compact ? 0 : spacing.xs,
      }}
    >
      <AppText variant="caption" style={{ color: look.fg }}>
        {look.word}
      </AppText>
    </View>
  );
}

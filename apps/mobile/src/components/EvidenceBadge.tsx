import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { type EvidenceKey, evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { AppText } from './AppText';

// Gives the 13/18 label the board's 24 dp pill.
const BADGE_PADDING_Y = 3;

// The label comes from the evidence reader alone; basicAnalysis only lowers it to Experimental (§11.10).
// Experimental is the default for every check, so repeating it on each card is noise: it is drawn only where
// showExperimental is set, which is the Accuracy screen (owner decision, 2026-10-09). Evidence data is untouched.
export function EvidenceBadge({
  metric,
  compact = false,
  basicAnalysis = false,
  showExperimental = false,
}: {
  metric: EvidenceKey;
  compact?: boolean;
  basicAnalysis?: boolean;
  showExperimental?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const label = basicAnalysis ? 'experimental' : evidenceFor(metric).label;
  if (label === 'experimental' && !showExperimental) return null;
  const look = {
    checked: { fg: colors.badgeCheckedFg, bg: colors.badgeCheckedBg, word: t('evidence.checked') },
    'public-data': { fg: colors.badgePublicFg, bg: colors.badgePublicBg, word: t('evidence.publicData') },
    experimental: {
      fg: colors.badgeFlagFg,
      bg: colors.badgeFlagBg,
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
        paddingVertical: compact ? 0 : BADGE_PADDING_Y,
      }}
    >
      <AppText variant="caption" style={{ color: look.fg, fontWeight: '600' }}>
        {look.word}
      </AppText>
    </View>
  );
}

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { evidenceFor, type EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { AppText } from './AppText';

type EvidenceBadgeProps = { metric: EvidenceMetric; flag?: undefined } | { flag: true; metric?: undefined };

// The label comes from the evidence reader alone; a flag is the only state a screen can ask for itself,
// and it stands for a fired decision rule rather than for accuracy.
export function EvidenceBadge({ metric, flag }: EvidenceBadgeProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const state = flag ? 'flag' : metric ? evidenceFor(metric).label : 'experimental';
  const look = {
    checked: { fg: colors.badgeCheckedFg, bg: colors.badgeCheckedBg, word: t('evidence.checked') },
    'public-data': { fg: colors.badgePublicFg, bg: colors.badgePublicBg, word: t('evidence.publicData') },
    experimental: {
      fg: colors.badgeExperimentalFg,
      bg: colors.badgeExperimentalBg,
      word: t('evidence.experimental'),
    },
    flag: { fg: colors.badgeFlagFg, bg: colors.badgeFlagBg, word: t('evidence.flag') },
  }[state];
  return (
    <View
      testID="evidence-badge"
      accessibilityLabel={look.word}
      style={{
        alignSelf: 'flex-start',
        backgroundColor: look.bg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
      }}
    >
      <AppText variant="caption" style={{ color: look.fg }}>
        {look.word}
      </AppText>
    </View>
  );
}

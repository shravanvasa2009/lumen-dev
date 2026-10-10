import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CHECK_ICON, CHECK_IDS, type CheckId } from '@/checks/checkPlan';
import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

// The list is one block for a screen reader; each check reads as its name and what it looks at.
export function FourChecks({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const names: Record<CheckId, string> = {
    afib: t('checks.afib.name'),
    hrv: t('checks.hrv.name'),
    diabetes: t('checks.diabetes.pattern'),
    pots: t('checks.pots.name'),
  };
  const whats: Record<CheckId, string> = {
    afib: t('checks.afib.what'),
    hrv: t('checks.hrv.what'),
    diabetes: t('checks.diabetes.what'),
    pots: t('checks.pots.whatShort'),
  };
  return (
    <View accessibilityLabel={t('checks.title')} style={{ gap: compact ? spacing.md : spacing.xl }}>
      {CHECK_IDS.map((check) => (
        <View
          key={check}
          accessible
          accessibilityLabel={`${names[check]}: ${whats[check]}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
        >
          <View style={{ width: 36, alignItems: 'center' }}>
            <Icon name={CHECK_ICON[check]} size={28} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{names[check]}</AppText>
            <AppText tone="textDim" style={{ fontSize: 15, lineHeight: 20 }}>
              {whats[check]}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

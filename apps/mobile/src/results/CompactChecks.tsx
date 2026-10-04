import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

type CompactRowProps = { icon: IconName; name: string; where: string; diabetesBadge?: boolean };

function CompactRow({ icon, name, where, diabetesBadge = false }: CompactRowProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Icon name={icon} size={20} color={colors.accent} />
      <AppText variant="headline">{name}</AppText>
      {diabetesBadge ? <EvidenceBadge metric="diabetes" /> : null}
      <AppText tone="textDim" style={{ flex: 1, textAlign: 'right' }}>
        {where}
      </AppText>
    </View>
  );
}

// A Quick Check covers rhythm and heart rate only; the other three checks show where they run.
export function CompactChecks() {
  const { t } = useTranslation();
  return (
    <>
      <CompactRow icon="bars" name={t('checks.hrv.name')} where={t('mode.full')} />
      <CompactRow icon="drop" name={t('checks.diabetes.name')} where={t('mode.full')} diabetesBadge />
      <CompactRow icon="standing" name={t('checks.pots.name')} where={t('checks.from.standing')} />
    </>
  );
}

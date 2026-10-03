import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

type CheckTileProps = {
  icon: IconName;
  name: string;
  what: string;
  from: string;
  experimental?: boolean;
  compact: boolean;
};

// A compact tile is one row (icon, name with its pill, one line) so all four checks fit above the pinned buttons
// on a 360 x 640 phone.
function CheckTile({ icon, name, what, from, experimental = false, compact }: CheckTileProps) {
  const { colors, radius, spacing } = useTheme();
  if (compact) {
    return (
      <View
        accessible
        style={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: radius.card,
        }}
      >
        <Icon name={icon} size={20} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <AppText variant="headline">{name}</AppText>
            {experimental ? <EvidenceBadge metric="diabetes" /> : null}
          </View>
          <AppText variant="caption" tone="textDim" numberOfLines={1}>
            {what}
          </AppText>
        </View>
      </View>
    );
  }
  return (
    <View
      accessible
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        gap: spacing.xs,
        padding: spacing.md,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.card - 6,
          backgroundColor: colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={20} color={colors.accent} />
      </View>
      <AppText variant="headline">{name}</AppText>
      {experimental ? <EvidenceBadge metric="diabetes" /> : null}
      <AppText variant="caption" tone="textDim">
        {what}
      </AppText>
      <AppText variant="caption" tone="textFaint">
        {from}
      </AppText>
    </View>
  );
}

// Which scan runs each check follows spec 06 and 12: POTS is only in the Standing test.
export function FourChecks({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel>{t('checks.title')}</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <CheckTile
          icon="pulse"
          name={t('checks.afib.name')}
          what={t('checks.afib.what')}
          from={t('checks.from.full')}
          compact={compact}
        />
        <CheckTile
          icon="trends"
          name={t('checks.hrv.name')}
          what={t('checks.hrv.what')}
          from={t('checks.from.full')}
          compact={compact}
        />
        <CheckTile
          icon="lens"
          name={t('checks.diabetes.name')}
          what={t('checks.diabetes.what')}
          from={t('checks.from.full')}
          experimental
          compact={compact}
        />
        <CheckTile
          icon="finger"
          name={t('checks.pots.name')}
          what={t('checks.pots.whatShort')}
          from={t('checks.from.standing')}
          compact={compact}
        />
      </View>
    </View>
  );
}

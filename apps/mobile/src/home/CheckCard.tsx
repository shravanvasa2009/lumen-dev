import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

// Compact Scan buttons draw 34 dp tall and keep the 44 dp touch target through hitSlop.
const SCAN_HEIGHT_COMPACT = 34;
const CARD_PADDING_COMPACT = 3;

type CheckCardProps = {
  icon: IconName;
  name: string;
  // POTS has no evidence entry, so it shows no badge.
  evidence?: EvidenceMetric;
  finding: string;
  // Opens the saved reading behind the finding; absent while there is none.
  onOpenFinding?: () => void;
  onScan: () => void;
  compact: boolean;
};

export function CheckCard({ icon, name, evidence, finding, onOpenFinding, onScan, compact }: CheckCardProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing, control } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
      {compact ? null : (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.card - 6,
            backgroundColor: colors.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={22} color={colors.accent} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <AppText variant="headline">{name}</AppText>
          {evidence ? <EvidenceBadge metric={evidence} compact={compact} /> : null}
        </View>
        <AppText variant="caption" tone="textDim">
          {finding}
        </AppText>
      </View>
    </View>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: compact ? CARD_PADDING_COMPACT : spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
      }}
    >
      {onOpenFinding ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name}: ${finding}`}
          onPress={onOpenFinding}
          style={{ flex: 1 }}
        >
          {body}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={`${name}: ${finding}`} style={{ flex: 1 }}>
          {body}
        </View>
      )}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('checks.scanFor', { name })}
        onPress={onScan}
        hitSlop={compact ? spacing.xs + 1 : 0}
        style={{
          minHeight: compact ? SCAN_HEIGHT_COMPACT : control.minTarget,
          minWidth: 72,
          paddingHorizontal: spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          borderWidth: 1.5,
          borderColor: colors.accent,
        }}
      >
        <AppText variant="headline" tone="accent">
          {t('checks.scan')}
        </AppText>
      </PressableScale>
    </View>
  );
}

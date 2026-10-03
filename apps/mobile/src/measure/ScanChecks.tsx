import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon } from '@/components/Icon';
import {
  CHECK_PILL,
  CHECK_ICON,
  CHECK_IDS,
  type CheckId,
  type LockWhy,
  checkCell,
  type PlanTier,
} from '@/checks/checkPlan';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

import type { MeasureMode } from './mode';

export function ScanChecks({ mode }: { mode: MeasureMode }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const tier: PlanTier = useStoredRating()?.tier ?? 'unrated';
  const names: Record<CheckId, string> = {
    afib: t('checks.afib.name'),
    hrv: t('checks.hrv.name'),
    diabetes: t('checks.diabetes.name'),
    pots: t('checks.pots.name'),
  };
  const reasons: Record<LockWhy, string> = {
    fps60: t('mode.locked60fps'),
    basic: t('mode.lockedBasic'),
    unsupported: t('mode.lockedUnsupported'),
  };
  const cells = CHECK_IDS.map((check) => ({ check, cell: checkCell(mode, check, tier) }));
  const running = cells.flatMap(({ check, cell }) => (cell.state === 'runs' ? [check] : []));
  const locked = cells.flatMap(({ check, cell }) => (cell.state === 'locked' ? [{ check, why: cell.why }] : []));
  const left = cells.flatMap(({ check, cell }) => (cell.state === 'notInScan' ? [names[check]] : []));
  return (
    <Card>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {t('checks.thisScanMode', { mode: mode === 'full' ? t('mode.full') : t('mode.quick') })}
      </AppText>
      {running.length === 0 ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {running.map((check) => {
            const pill = CHECK_PILL[check];
            return (
              <View
                key={check}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface2,
                }}
              >
                <Icon name={CHECK_ICON[check]} size={16} color={colors.accent} />
                <AppText variant="headline" tone="accent">
                  {names[check]}
                </AppText>
                {pill === null ? null : <EvidenceBadge metric={pill} />}
              </View>
            );
          })}
        </View>
      )}
      {locked.map(({ check, why }) => (
        <View key={check} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="lock" size={16} color={colors.textFaint} />
          <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
            {`${names[check]}: ${reasons[why]}`}
          </AppText>
        </View>
      ))}
      {left.length === 0 ? null : (
        <AppText variant="caption" tone="textDim">
          {t('checks.notInScan', { names: left.join(', ') })}
        </AppText>
      )}
    </Card>
  );
}

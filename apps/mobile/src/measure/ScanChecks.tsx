import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { MeasureMode } from './mode';

type ScanCheck = { icon: IconName; name: string; experimental?: boolean };

// Which checks a scan runs follows spec 06 and 12: Quick Check reads rhythm only, Full Scan adds HRV and the
// diabetes pulse pattern, and POTS only comes from the Standing test.
export function ScanChecks({ mode }: { mode: MeasureMode }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const afib: ScanCheck = { icon: 'pulse', name: t('checks.afib.name') };
  const hrv: ScanCheck = { icon: 'trends', name: t('checks.hrv.name') };
  const diabetes: ScanCheck = { icon: 'lens', name: t('checks.diabetes.name'), experimental: true };
  const pots = t('checks.pots.name');
  const runs = mode === 'full' ? [afib, hrv, diabetes] : [afib];
  const notRun = (mode === 'full' ? [] : [hrv.name, diabetes.name]).concat(pots).join(', ');
  return (
    <Card>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {t('checks.thisScanMode', { mode: mode === 'full' ? t('mode.full') : t('mode.quick') })}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {runs.map(({ icon, name, experimental }) => (
          <View
            key={name}
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
            <Icon name={icon} size={16} color={colors.accent} />
            <AppText variant="headline" tone="accent">
              {name}
            </AppText>
            {experimental ? <EvidenceBadge metric="diabetes" /> : null}
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="textDim">
        {t('checks.notInScan', { names: notRun })}
      </AppText>
    </Card>
  );
}

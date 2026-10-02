import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { LabPanel } from '@/dev/LabPanel';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

import { LumenCapture } from '../../modules/lumen-capture/src';

export default function LabScreen() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <RouteShell title={t('lab.title')}>
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: colors.surface3,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        }}
      >
        <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
          {t('lab.badge')}
        </AppText>
      </View>
      {/* The capture sender exists only in development builds (PRIV-1, ADR 0026). */}
      {__DEV__ ? <LabPanel capture={LumenCapture} /> : null}
      <SectionLabel>{t('lab.sqi')}</SectionLabel>
      <Card>
        <AppText tone="textDim">{t('lab.notAvailable')}</AppText>
      </Card>
      <SectionLabel>{t('lab.reference')}</SectionLabel>
      <Card>
        <AppText tone="textDim">{t('lab.notAvailable')}</AppText>
      </Card>
    </RouteShell>
  );
}

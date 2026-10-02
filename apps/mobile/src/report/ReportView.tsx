import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { DemoBanner } from '@/results/DemoBanner';
import { readingById, readingsOnDay } from '@/results/fixtures';
import { useTheme } from '@/theme';

import { ReportCard } from './ReportCard';

// Readings resolve from fixtures only for now, so the route passes `demo`; a real reading would not carry
// the banner or the card's "Demo" mark. PDF export needs expo-print and expo-sharing, which arrive with a
// new dev build.
export function ReportView({ id, demo }: { id: string | undefined; demo: boolean }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const reading = readingById(id);
  return (
    <RouteShell
      title={t('report.title')}
      footer={
        <>
          <Button label={t('report.sharePdf')} disabled onPress={() => undefined} />
          <View style={{ gap: spacing.xs }}>
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('report.sharedOnly')}
            </AppText>
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
              {t('report.shareLater')}
            </AppText>
          </View>
        </>
      }
    >
      {reading ? (
        <>
          {demo ? <DemoBanner synthetic={reading.synthetic} /> : null}
          <ReportCard reading={reading} dayReadings={readingsOnDay(reading.createdAt)} demo={demo} />
        </>
      ) : (
        <Card>
          <AppText variant="headline">{t('report.notFoundTitle')}</AppText>
          <AppText tone="textDim">{t('report.notFound')}</AppText>
        </Card>
      )}
    </RouteShell>
  );
}

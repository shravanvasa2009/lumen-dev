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

// Every reading the app can resolve today is a Demo fixture, so the banner and the card's own "Demo" mark
// always show. PDF export needs expo-print and expo-sharing, which arrive with a new dev build.
export function ReportView({ id }: { id: string | undefined }) {
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
          <DemoBanner synthetic={reading.synthetic} />
          <ReportCard reading={reading} dayReadings={readingsOnDay(reading.createdAt)} />
        </>
      ) : (
        <Card>
          <AppText variant="headline">{t('result.inconclusive')}</AppText>
          <AppText tone="textDim">{t('report.notFound')}</AppText>
        </Card>
      )}
    </RouteShell>
  );
}

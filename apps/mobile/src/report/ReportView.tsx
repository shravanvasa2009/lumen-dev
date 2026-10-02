import { printToFileAsync } from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { DemoBanner } from '@/results/DemoBanner';
import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';
import { useTheme } from '@/theme';

import { ReportCard } from './ReportCard';
import { buildReportHtml } from './pdfHtml';

// Readings resolve from fixtures only for now, so the route passes `demo`; a real reading would not carry
// the banner or the card's "Demo" mark.
export function ReportView({ id, demo }: { id: string | undefined; demo: boolean }) {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const [sharing, setSharing] = useState<'idle' | 'busy' | 'failed'>('idle');
  const reading = readingById(id);

  async function sharePdf(shown: FixtureReading) {
    setSharing('busy');
    try {
      const html = buildReportHtml({
        t,
        language: i18n.language,
        reading: shown,
        dayReadings: readingsOnDay(shown.createdAt),
        demo,
      });
      const { uri } = await printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) {
        setSharing('failed');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      setSharing('idle');
    } catch {
      setSharing('failed');
    }
  }

  return (
    <RouteShell
      title={t('report.title')}
      footer={
        <>
          {reading ? (
            <Button
              label={sharing === 'busy' ? t('report.sharing') : t('report.sharePdf')}
              disabled={sharing === 'busy'}
              onPress={() => void sharePdf(reading)}
            />
          ) : null}
          <View style={{ gap: spacing.xs }}>
            {sharing === 'failed' ? (
              <AppText accessibilityRole="alert" style={{ textAlign: 'center' }}>
                {t('report.shareFailed')}
              </AppText>
            ) : null}
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('report.sharedOnly')}
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

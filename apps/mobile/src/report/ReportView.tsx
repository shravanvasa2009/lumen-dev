import { File } from 'expo-file-system';
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
import type { FixtureReading } from '@/results/fixtures';
import { useTheme } from '@/theme';

import { ReportCard } from './ReportCard';
import { buildReportHtml } from './pdfHtml';
import { useReportReading } from './useReportReading';

// A sample or Demo reading carries the banner and the card's "Demo" mark; a reading saved on this phone
// does not.
export function ReportView({ id }: { id: string | undefined }) {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const [sharing, setSharing] = useState<'idle' | 'busy' | 'failed'>('idle');
  const { reading, dayReadings, dayReady } = useReportReading(id);

  async function sharePdf(shown: FixtureReading) {
    setSharing('busy');
    let pdf: File | null = null;
    try {
      const html = buildReportHtml({
        t,
        language: i18n.language,
        reading: shown,
        dayReadings,
        demo: shown.sample,
      });
      const { uri } = await printToFileAsync({ html });
      pdf = new File(uri);
      if (!(await Sharing.isAvailableAsync())) {
        setSharing('failed');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      setSharing('idle');
    } catch {
      setSharing('failed');
    } finally {
      // PRIV-1: the PDF holds health values, so it does not stay in the cache once the share sheet closes.
      try {
        if (pdf?.exists) pdf.delete();
      } catch {
        setSharing('failed');
      }
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
              disabled={sharing === 'busy' || !dayReady}
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
          {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
          <ReportCard reading={reading} dayReadings={dayReadings} demo={reading.sample} />
        </>
      ) : reading === null ? (
        <Card>
          <AppText variant="headline">{t('report.notFoundTitle')}</AppText>
          <AppText tone="textDim">{t('report.notFound')}</AppText>
        </Card>
      ) : null}
    </RouteShell>
  );
}

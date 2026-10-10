import { File } from 'expo-file-system';
import { printToFileAsync } from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { InconclusiveOutcome } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { handedInconclusive } from '@/measure/inconclusiveHandoff';
import { DemoBanner } from '@/results/DemoBanner';
import { useTheme } from '@/theme';

import { InconclusiveReportCard } from './InconclusiveReportCard';
import { INCONCLUSIVE_REPORT_ID } from './inconclusiveReport';
import { ReportCard } from './ReportCard';
import { buildInconclusiveReportHtml, buildReportHtml } from './pdfHtml';
import { useReportReading } from './useReportReading';

type ReportViewProps = {
  id: string | undefined;
  // The pre-check answers of a refused capture, as the route carries them: "caffeine,exercise".
  context?: string;
};

type SharingState = 'idle' | 'busy' | 'failed';

// The PDF holds health values, so it does not stay in the cache once the share sheet closes (PRIV-1).
async function sharePdf(html: string, setSharing: (state: SharingState) => void) {
  setSharing('busy');
  let pdf: File | null = null;
  try {
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
    try {
      if (pdf?.exists) pdf.delete();
    } catch {
      setSharing('failed');
    }
  }
}

// A report exists for every reading, including a lower-quality one (it carries a plain quality note) and a
// refused capture (it carries only what was measured). A sample or Demo reading carries the banner and the
// card's Demo mark; a reading saved on this phone does not.
export function ReportView({ id, context }: ReportViewProps) {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const [sharing, setSharing] = useState<SharingState>('idle');
  const refused = id === INCONCLUSIVE_REPORT_ID;
  const { reading, dayReadings, dayReady } = useReportReading(refused ? undefined : id);
  const outcome: InconclusiveOutcome | null = refused ? handedInconclusive() : null;
  const answers = context ? context.split(',') : [];
  // Fixed at first render so the date on the page and in the PDF cannot differ across midnight.
  const [madeAt] = useState(() => new Date());

  const buildHtml = outcome
    ? () => buildInconclusiveReportHtml({ t, language: i18n.language, outcome, context: answers, madeAt })
    : reading
      ? () => buildReportHtml({ t, language: i18n.language, reading, dayReadings, demo: reading.sample })
      : null;
  const ready = refused ? outcome !== null : dayReady;

  return (
    <RouteShell
      title={t('report.title')}
      footer={
        <>
          {buildHtml ? (
            <Button
              label={sharing === 'busy' ? t('report.sharing') : t('report.sharePdf')}
              icon="share"
              disabled={sharing === 'busy' || !ready}
              onPress={() => void sharePdf(buildHtml(), setSharing)}
            />
          ) : null}
          {sharing === 'failed' ? (
            <AppText accessibilityRole="alert" style={{ textAlign: 'center' }}>
              {t('report.shareFailed')}
            </AppText>
          ) : null}
        </>
      }
    >
      {outcome ? (
        <InconclusiveReportCard outcome={outcome} context={answers} madeAt={madeAt} />
      ) : reading ? (
        <>
          {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
          <ReportCard reading={reading} dayReadings={dayReadings} demo={reading.sample} />
          <AppText variant="caption" tone="textDim" style={{ paddingHorizontal: spacing.lg }}>
            {t('report.sharedOnly')}
          </AppText>
        </>
      ) : refused || reading === null ? (
        <Card>
          <AppText variant="headline">{t('report.notFoundTitle')}</AppText>
          <AppText tone="textDim">{refused ? t('report.noRefused') : t('report.notFound')}</AppText>
        </Card>
      ) : null}
    </RouteShell>
  );
}

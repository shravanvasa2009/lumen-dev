import { useTranslation } from 'react-i18next';

import { AccuracyRow } from '@/accuracy/AccuracyRow';
import { formatDate } from '@/accuracy/format';
import { bundledAccuracy, bundledEvidenceDate } from '@/accuracy/readAccuracy';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';

export default function AccuracyScreen() {
  const { t, i18n } = useTranslation();
  const metrics = [
    { metric: 'hr', heading: t('accuracy.heartRate') },
    { metric: 'rhythm', heading: t('accuracy.rhythm') },
    { metric: 'hrv', heading: t('accuracy.hrv') },
    { metric: 'resp', heading: t('accuracy.breathing') },
    { metric: 'diabetes', heading: t('accuracy.diabetes') },
    { metric: 'extraBeats', heading: t('accuracy.extraBeats') },
  ] as const;
  const date = bundledEvidenceDate ? formatDate(bundledEvidenceDate, i18n.language) : null;
  return (
    <RouteShell title={t('accuracy.title')} subtitle={t('accuracy.subtitle')}>
      <Card flush>
        {metrics.map(({ metric, heading }, index) => (
          <AccuracyRow
            key={metric}
            metric={metric}
            heading={heading}
            figures={bundledAccuracy[metric]}
            last={index === metrics.length - 1}
          />
        ))}
      </Card>
      <Card>
        <AppText tone="textDim">{t('accuracy.falseAlarms')}</AppText>
      </Card>
      <AppText variant="caption" tone="textFaint">
        {t('prototype.banner')}
      </AppText>
      {date ? (
        <AppText variant="caption" tone="textFaint">
          {t('accuracy.evidenceDate', { date })}
        </AppText>
      ) : null}
    </RouteShell>
  );
}

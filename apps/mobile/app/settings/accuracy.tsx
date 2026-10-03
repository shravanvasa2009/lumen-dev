import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AccuracyRow } from '@/accuracy/AccuracyRow';
import { formatDate } from '@/accuracy/format';
import { bundledAccuracy, bundledEvidenceDate, countChecked } from '@/accuracy/readAccuracy';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { RouteShell } from '@/components/RouteShell';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

export default function AccuracyScreen() {
  const { t, i18n } = useTranslation();
  const metrics = [
    { metric: 'hr', heading: t('accuracy.heartRate'), icon: 'pulse' },
    { metric: 'rhythm', heading: t('accuracy.rhythm'), icon: 'trends' },
    { metric: 'hrv', heading: t('accuracy.hrv'), icon: 'clock' },
    { metric: 'resp', heading: t('accuracy.breathing'), icon: 'lens' },
    { metric: 'diabetes', heading: t('accuracy.diabetes'), icon: 'finger' },
    { metric: 'extraBeats', heading: t('accuracy.extraBeats'), icon: 'hint' },
  ] as const satisfies readonly { metric: EvidenceMetric; heading: string; icon: IconName }[];
  const { checked, total } = countChecked(bundledAccuracy);
  const { colors, spacing } = useTheme();
  const date = bundledEvidenceDate ? formatDate(bundledEvidenceDate, i18n.language) : null;
  return (
    <RouteShell title={t('accuracy.title')} subtitle={t('accuracy.subtitle')}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name="hint" size={20} color={colors.textDim} />
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{t('accuracy.summaryTitle')}</AppText>
            <AppText>{t('accuracy.summary', { checked, total })}</AppText>
            <AppText tone="textDim">{t('accuracy.summaryRest')}</AppText>
          </View>
        </View>
      </Card>
      <Card flush>
        {metrics.map(({ metric, heading, icon }, index) => (
          <AccuracyRow
            key={metric}
            metric={metric}
            heading={heading}
            icon={icon}
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

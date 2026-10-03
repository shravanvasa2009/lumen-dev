import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Confidence } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { ConfidenceDots } from './ConfidenceDots';

type MetricCardProps = {
  title: string;
  // The short check name shown before the title, e.g. "AFib · Heart rhythm".
  checkName?: string;
  evidenceMetric: EvidenceMetric;
  // Null when the metric missed its clean-data floor; that card alone says so (§6.2).
  reading: { value: string; note: string; confidence: Confidence; flagged: boolean } | null;
};

export function MetricCard({ title, checkName, evidenceMetric, reading }: MetricCardProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexShrink: 1 }}>
          {checkName ? (
            <AppText variant="headline">{checkName}</AppText>
          ) : null}
          {checkName ? <AppText tone="textDim">·</AppText> : null}
          <AppText tone="textDim">{title}</AppText>
        </View>
        {reading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {reading.flagged ? (
              <View
                style={{
                  backgroundColor: colors.badgeFlagBg,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <AppText variant="caption" style={{ color: colors.badgeFlagFg }}>
                  {t('results.flag')}
                </AppText>
              </View>
            ) : null}
            <EvidenceBadge metric={evidenceMetric} />
            <ConfidenceDots confidence={reading.confidence} />
          </View>
        ) : null}
      </View>
      {reading ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <AppText variant="title">{reading.value}</AppText>
          <AppText tone="textDim" style={{ flexShrink: 1, textAlign: 'right' }}>
            {reading.note}
          </AppText>
        </View>
      ) : (
        <AppText variant="headline">{t('result.inconclusive')}</AppText>
      )}
    </Card>
  );
}

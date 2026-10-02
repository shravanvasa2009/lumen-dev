import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { accuracyLines } from './accuracyLines';
import type { AccuracyFigures } from './readAccuracy';

type AccuracyRowProps = {
  metric: EvidenceMetric;
  heading: string;
  figures: AccuracyFigures;
  last: boolean;
};

export function AccuracyRow({ metric, heading, figures, last }: AccuracyRowProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const { headline, details } = accuracyLines(metric, figures, t, i18n.language);
  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.xs,
        borderBottomColor: colors.line,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }}
    >
      <View style={[styles.headingRow, { gap: spacing.md }]}>
        <AppText variant="headline" style={styles.heading}>
          {heading}
        </AppText>
        <EvidenceBadge metric={metric} />
      </View>
      <AppText>{headline}</AppText>
      {details.map((line) => (
        <AppText key={line} variant="caption" tone="textDim">
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { flex: 1 },
});

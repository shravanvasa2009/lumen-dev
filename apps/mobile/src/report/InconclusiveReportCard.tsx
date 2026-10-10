import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { InconclusiveOutcome } from '@lumen/core';

import { LumenMark } from '@/settings/LumenMark';
import { useTheme } from '@/theme';

import { formatFullDate, inconclusiveLines } from './model';
import { paper } from './paper';
import { PaperText } from './PaperText';

type InconclusiveReportCardProps = {
  outcome: InconclusiveOutcome;
  context: readonly string[];
  madeAt: Date;
};

// The page for a capture Lumen refused: only what was measured and why it fell short. It has no heart rate,
// rhythm or HRV, because none was reported.
export function InconclusiveReportCard({ outcome, context, madeAt }: InconclusiveReportCardProps) {
  const { t, i18n } = useTranslation();
  const { radius, spacing, shadow } = useTheme();
  const { facts, lost } = inconclusiveLines(t, outcome, context);
  return (
    <View
      style={{
        backgroundColor: paper.surface,
        borderRadius: radius.sheet,
        padding: spacing.xl,
        gap: spacing.md,
        ...shadow.raised,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <LumenMark size={32} color={paper.accent} />
        <View style={{ flex: 1 }}>
          <PaperText variant="headline" accessibilityRole="header">
            {t('report.heading')}
          </PaperText>
          <PaperText variant="caption" tone="textDim">
            {formatFullDate(madeAt, i18n.language)}
          </PaperText>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: paper.line }} />
      <PaperText variant="headline">{t('result.inconclusive')}</PaperText>
      {facts.map((fact) => (
        <PaperText key={fact}>{fact}</PaperText>
      ))}
      {lost.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <PaperText bold>{t('inconclusive.where')}</PaperText>
          {lost.map((line) => (
            <PaperText key={line} variant="caption" tone="textDim">
              {line}
            </PaperText>
          ))}
        </View>
      ) : null}
      <PaperText tone="textDim">
        <PaperText tone="textDim" bold>
          {t('report.methodLabel')}
        </PaperText>{' '}
        {t('report.method')}
      </PaperText>
      <PaperText variant="caption" bold style={{ fontWeight: '600' }}>
        {t('prototype.banner')}
      </PaperText>
    </View>
  );
}

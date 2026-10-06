import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { evidenceFor } from '@/evidence';
import type { FixtureReading } from '@/results/fixtures';
import { LumenMark } from '@/settings/LumenMark';
import { useTheme } from '@/theme';

import { IntervalStrip } from './IntervalStrip';
import {
  columnHeadings,
  diabetesFor,
  diabetesSentence,
  flagCounts,
  formatFullDate,
  reportEvidence,
  qualityLines,
  stripsFor,
  tableRows,
} from './model';
import { paper } from './paper';
import { PaperText } from './PaperText';

const columnWeights = [1.1, 1, 0.7, 1.5, 1] as const;

function Labelled({ label, children }: { label: string; children: string }) {
  return (
    <PaperText>
      <PaperText bold>{label}</PaperText> {children}
    </PaperText>
  );
}

type ReportCardProps = { reading: FixtureReading; dayReadings: readonly FixtureReading[]; demo: boolean };

// The page a doctor would read: only core results with their evidence labels. Experimental measurements
// are left out (§12.5, §6.3), and so is any profile line, because the app stores no profile yet.
export function ReportCard({ reading, dayReadings, demo }: ReportCardProps) {
  const { t, i18n } = useTranslation();
  const { radius, spacing } = useTheme();
  const language = i18n.language;
  const counts = flagCounts(dayReadings);
  const diabetes = diabetesFor(dayReadings, evidenceFor('diabetes').measured);
  const strips = stripsFor(t, language, dayReadings);
  const evidence = reportEvidence(t, language, diabetes !== null);

  return (
    <View
      style={{
        backgroundColor: paper.surface,
        borderColor: paper.line,
        borderWidth: 1,
        borderRadius: radius.card,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <LumenMark size={32} color={paper.accent} />
        <PaperText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>
          {t('report.heading')}
        </PaperText>
        <PaperText variant="caption" tone="textDim">
          {formatFullDate(reading.createdAt, language)}
        </PaperText>
      </View>
      {demo ? (
        <View
          style={{
            alignSelf: 'flex-start',
            backgroundColor: paper.badgeExperimentalBg,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
          }}
        >
          <PaperText variant="caption" bold style={{ color: paper.badgeExperimentalFg }}>
            {t('report.demoMark')}
          </PaperText>
        </View>
      ) : null}
      <PaperText tone="flag" bold>
        {t('prototype.banner')}
      </PaperText>

      {counts.rhythm.flagged > 0 ? (
        <Labelled label={t('report.flagLabel')}>{t('report.flagRhythm', counts.rhythm)}</Labelled>
      ) : null}
      {counts.hr.flagged > 0 ? (
        <Labelled label={t('report.flagLabel')}>{t('report.flagHr', counts.hr)}</Labelled>
      ) : null}

      <View>
        <View style={{ flexDirection: 'row', backgroundColor: paper.surface2, padding: spacing.sm }}>
          {columnHeadings(t).map((heading, column) => (
            <PaperText key={heading} variant="caption" style={{ flex: columnWeights[column] }}>
              {heading}
            </PaperText>
          ))}
        </View>
        {tableRows(t, language, dayReadings).map(({ id, cells }) => (
          <View key={id} style={{ flexDirection: 'row', padding: spacing.sm }}>
            {cells.map((cell, column) => (
              <PaperText key={column} variant="caption" style={{ flex: columnWeights[column] }}>
                {cell}
              </PaperText>
            ))}
          </View>
        ))}
      </View>

      {qualityLines(t, language, dayReadings).map((line) => (
        <PaperText key={line} variant="caption" tone="textDim">
          {line}
        </PaperText>
      ))}

      {diabetes ? (
        <Labelled label={t('report.diabetesLabel')}>{diabetesSentence(t, language, diabetes)}</Labelled>
      ) : null}

      {strips.map(({ id, caption, intervalsMs, flagged }) => (
        <View key={id} style={{ gap: spacing.xs }}>
          <PaperText bold>{caption}</PaperText>
          <IntervalStrip
            intervalsMs={intervalsMs}
            color={flagged ? paper.flag : paper.text}
            label={caption}
          />
        </View>
      ))}
      {strips.length > 0 ? (
        <PaperText variant="caption" tone="textDim">
          {t('report.intervalNote')}
        </PaperText>
      ) : null}
      {dayReadings.some(({ synthetic }) => synthetic) ? (
        <PaperText variant="caption" tone="textDim">
          {t('demo.synthetic')}
        </PaperText>
      ) : null}

      <PaperText tone="textDim">
        <PaperText tone="textDim" bold>
          {`${t('report.evidence')}:`}
        </PaperText>{' '}
        {evidence}
      </PaperText>
      <PaperText tone="textDim">
        <PaperText tone="textDim" bold>
          {t('report.methodLabel')}
        </PaperText>{' '}
        {t('report.method')}
      </PaperText>
      <PaperText variant="caption" tone="textDim">
        {t('report.leftOut')}
      </PaperText>
    </View>
  );
}

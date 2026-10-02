import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { accuracyLines } from '@/accuracy/accuracyLines';
import { bundledAccuracy } from '@/accuracy/readAccuracy';
import { evidenceFor, type EvidenceMetric } from '@/evidence';
import type { FixtureReading } from '@/results/fixtures';
import { formatClock, formatDay } from '@/results/format';
import { rhythmWords } from '@/results/rhythmWords';
import { LumenMark } from '@/settings/LumenMark';
import { useTheme } from '@/theme';

import { IntervalStrip } from './IntervalStrip';
import { diabetesFor, evidenceSentence, evidenceWord, flagCounts, formatFullDate } from './model';
import { paper } from './paper';
import { PaperText } from './PaperText';

const columnWeights = [1.1, 1, 0.7, 1.5, 1] as const;
const stripLimit = 3;

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
  const strips = dayReadings.filter(({ intervalsMs }) => intervalsMs.length > 0).slice(0, stripLimit);
  const evidenceRows: readonly { metric: EvidenceMetric; heading: string }[] = [
    { metric: 'hr', heading: t('accuracy.heartRate') },
    { metric: 'rhythm', heading: t('accuracy.rhythm') },
    ...(diabetes ? [{ metric: 'diabetes' as const, heading: t('accuracy.diabetes') }] : []),
  ];
  const evidence = evidenceRows
    .map(({ metric, heading }) =>
      evidenceSentence(
        heading,
        evidenceWord(t, evidenceFor(metric).label),
        accuracyLines(metric, bundledAccuracy[metric], t, language),
      ),
    )
    .join(' ');

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
          {[
            t('report.colTime'),
            t('report.colMode'),
            t('report.colHr'),
            t('report.colRhythm'),
            t('report.colClean'),
          ].map((heading, column) => (
            <PaperText key={heading} variant="caption" style={{ flex: columnWeights[column] }}>
              {heading}
            </PaperText>
          ))}
        </View>
        {dayReadings.map((row) => {
          const cells = [
            formatClock(row.createdAt, language),
            row.mode === 'full' ? t('report.modeFull') : t('report.modeQuick'),
            row.scan.metrics.hr ? String(row.scan.metrics.hr.value) : '—',
            row.scan.metrics.rhythm ? rhythmWords(t, row.scan.metrics.rhythm).value : '—',
            String(row.scan.cleanSeconds),
          ];
          return (
            <View key={row.id} style={{ flexDirection: 'row', padding: spacing.sm }}>
              {cells.map((cell, column) => (
                <PaperText key={column} variant="caption" style={{ flex: columnWeights[column] }}>
                  {cell}
                </PaperText>
              ))}
            </View>
          );
        })}
      </View>

      {diabetes ? (
        <Labelled label={t('report.diabetesLabel')}>
          {[
            diabetes.metric.flag === 'pattern'
              ? t('results.diabetesSeen', {
                  readings: diabetes.metric.readingsUsed,
                  days: diabetes.days.map((day) => formatDay(day, language)).join(', '),
                })
              : t('report.diabetesNotSeen'),
            t('report.notDiagnostic'),
          ].join(' ')}
        </Labelled>
      ) : null}

      {strips.map((row) => {
        const caption = t('report.intervalStrip', {
          time: formatClock(row.createdAt, language),
          mode: row.mode === 'full' ? t('mode.full') : t('mode.quick'),
        });
        return (
          <View key={row.id} style={{ gap: spacing.xs }}>
            <PaperText bold>{caption}</PaperText>
            <IntervalStrip
              intervalsMs={row.intervalsMs}
              color={row.scan.metrics.rhythm?.flag ? paper.flag : paper.text}
              label={caption}
            />
          </View>
        );
      })}
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

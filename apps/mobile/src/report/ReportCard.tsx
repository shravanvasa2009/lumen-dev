import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { intervalAxis } from '@/results/axis';
import { PoincarePlot } from '@/results/PoincarePlot';
import { rhythmMapShape } from '@/results/poincare';

import { evidenceFor } from '@/evidence';
import { formatClock } from '@/results/format';
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
  measurementLines,
  qualityNote,
  reportEvidenceRows,
  qualityLines,
  stripsFor,
  tableRows,
} from './model';
import { paper } from './paper';
import { PaperText } from './PaperText';

const columnWeights = [1.1, 1, 0.7, 1.5, 1] as const;
const MAP_SIZE = 96;
const measurementIcons: Record<string, IconName> = {
  hr: 'heart',
  rhythm: 'rhythm',
  hrv: 'bars',
  resp: 'breath',
};

function Divider({ marginTop, marginBottom }: { marginTop: number; marginBottom: number }) {
  return <View style={{ height: 1, backgroundColor: paper.line, marginTop, marginBottom }} />;
}

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
  const { radius, spacing, shadow } = useTheme();
  const language = i18n.language;
  const counts = flagCounts(dayReadings);
  const diabetes = diabetesFor(dayReadings, evidenceFor('diabetes').measured);
  const strips = stripsFor(t, language, dayReadings);
  const evidence = reportEvidenceRows(t, language, diabetes !== null);
  const mapShape = rhythmMapShape(reading.intervalsMs);
  const lines = measurementLines(t, reading);
  const note = qualityNote(t, reading);

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
            {formatFullDate(reading.createdAt, language)}
          </PaperText>
        </View>
      </View>
      <Divider marginTop={spacing.xs} marginBottom={spacing.xs} />
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
      <PaperText variant="caption" tone="textDim">
        {[
          reading.mode === 'full' ? t('mode.full') : t('mode.quick'),
          t('results.cleanSeconds', { seconds: Math.floor(reading.scan.cleanSeconds) }),
          formatClock(reading.createdAt, language),
        ].join(' · ')}
      </PaperText>
      <View
        accessibilityRole={note ? 'alert' : 'summary'}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm + 2,
          backgroundColor: note ? paper.flagBg : paper.accentTint,
          borderRadius: radius.card - 4,
          padding: spacing.md,
        }}
      >
        <Icon name={note ? 'warning' : 'check'} size={20} color={note ? paper.flag : paper.accent} />
        <View style={{ flex: 1 }}>
          <PaperText style={{ fontWeight: '600' }}>{note ?? t('report.qualityGood')}</PaperText>
          {note ? null : (
            <PaperText variant="caption" tone="textDim">
              {t('report.everyReading')}
            </PaperText>
          )}
        </View>
      </View>
      <View>
        {lines.map(({ key, title, value, note: detail }, position) => (
          <View key={key} style={{ flexDirection: 'row' }}>
            <View
              style={{ width: 28, marginRight: spacing.md, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={measurementIcons[key] ?? 'heart'} size={22} color={paper.accent} />
            </View>
            <View
              style={{
                flex: 1,
                minHeight: 60,
                paddingVertical: spacing.sm + 1,
                justifyContent: 'center',
                borderBottomColor: paper.line,
                borderBottomWidth: position === lines.length - 1 ? 0 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                <PaperText style={{ flex: 1 }}>{title}</PaperText>
                <PaperText bold style={{ flexShrink: 1, textAlign: 'right' }}>
                  {value}
                </PaperText>
              </View>
              <PaperText variant="caption" tone="textDim">
                {detail}
              </PaperText>
            </View>
          </View>
        ))}
      </View>

      {mapShape ? (
        <>
          <Divider marginTop={spacing.xs} marginBottom={spacing.sm} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
            <View style={{ width: MAP_SIZE }}>
              <PoincarePlot
                intervalsMs={reading.intervalsMs}
                axis={intervalAxis(reading.intervalsMs)}
                color={paper.accent}
                label={t('why.rhythmMap')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PaperText variant="headline">{t('why.rhythmMap')}</PaperText>
              <PaperText variant="caption" tone="textDim">
                {t('why.poincare')}
              </PaperText>
              <PaperText style={{ marginTop: spacing.sm }}>{t('report.mapNote')}</PaperText>
              <PaperText variant="caption" tone="textDim" style={{ marginTop: spacing.sm }}>
                {t('report.mapSpread', { sd1: Math.round(mapShape.sd1Ms), sd2: Math.round(mapShape.sd2Ms) })}
              </PaperText>
            </View>
          </View>
        </>
      ) : null}

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

      <Divider marginTop={spacing.xs} marginBottom={spacing.xs} />
      <PaperText variant="caption">{t('result.notChecked')}</PaperText>
      <View style={{ gap: spacing.xs }}>
        <PaperText variant="caption" bold style={{ fontWeight: '600' }}>
          {t('report.evidence')}
        </PaperText>
        {evidence.map(({ heading, text }) => (
          <PaperText key={heading} variant="caption" tone="textDim">
            <PaperText variant="caption">{`${heading}:`}</PaperText> {text}
          </PaperText>
        ))}
      </View>
      <PaperText variant="caption" tone="textDim">
        <PaperText variant="caption" bold style={{ fontWeight: '600' }}>
          {t('report.methodLabel')}
        </PaperText>{' '}
        {t('report.method')}
      </PaperText>
      <PaperText variant="caption" tone="textDim">
        {t('report.leftOut')}
      </PaperText>
      <PaperText variant="caption" bold style={{ fontWeight: '600' }}>
        {t('prototype.banner')}
      </PaperText>
    </View>
  );
}

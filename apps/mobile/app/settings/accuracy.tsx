import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AccuracyRow } from '@/accuracy/AccuracyRow';
import { CheckedRing } from '@/accuracy/CheckedRing';
import { formatDate } from '@/accuracy/format';
import { LabelChip } from '@/accuracy/LabelChip';
import { bundledAccuracy, bundledEvidenceDate, countChecked } from '@/accuracy/readAccuracy';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import type { IconName } from '@/components/Icon';
import { RouteShell } from '@/components/RouteShell';
import { type EvidenceMetric, evidenceFor, evidenceMetrics } from '@/evidence';
import { IconTile } from '@/settings/IconTile';
import { useTheme } from '@/theme';

// The board sets this screen in a 20 px side margin, 4 px inside the app's 16 px gutter.
const EXTRA_SIDE_MARGIN = 4;

export default function AccuracyScreen() {
  const { t, i18n } = useTranslation();
  const metrics = [
    { metric: 'hr', heading: t('accuracy.heartRate'), icon: 'heart' },
    { metric: 'rhythm', heading: t('accuracy.rhythm'), icon: 'rhythm' },
    { metric: 'hrv', heading: t('accuracy.hrv'), icon: 'clock' },
    { metric: 'resp', heading: t('accuracy.breathing'), icon: 'breath' },
    { metric: 'diabetes', heading: t('accuracy.diabetes'), icon: 'drop' },
    { metric: 'extraBeats', heading: t('accuracy.extraBeats'), icon: 'extraBeat' },
  ] as const satisfies readonly { metric: EvidenceMetric; heading: string; icon: IconName }[];
  const { checked, total } = countChecked(bundledAccuracy);
  const { colors, spacing } = useTheme();
  const date = bundledEvidenceDate ? formatDate(bundledEvidenceDate, i18n.language) : null;
  const labelCount = (label: 'checked' | 'public-data' | 'experimental') =>
    evidenceMetrics.filter((metric) => evidenceFor(metric).label === label).length;
  const legend = [
    { word: t('evidence.checked'), dot: colors.badgeCheckedFg, count: labelCount('checked') },
    { word: t('evidence.publicData'), dot: colors.badgePublicFg, count: labelCount('public-data') },
    { word: t('evidence.experimental'), dot: colors.flagFill, count: labelCount('experimental') },
  ];
  return (
    <RouteShell title={t('accuracy.title')}>
      <View style={{ gap: spacing.xxl, paddingHorizontal: EXTRA_SIDE_MARGIN }}>
        <AppText tone="textDim">{t('accuracy.subtitle')}</AppText>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <CheckedRing checked={checked} total={total} />
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <AppText variant="headline">{t('accuracy.summaryTitle')}</AppText>
              {legend.map(({ word, dot, count }) => (
                <View key={word} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
                  <AppText variant="subheadline" style={{ flex: 1, minWidth: 0 }}>
                    {word}
                  </AppText>
                  <AppText variant="headline" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                    {count}
                  </AppText>
                </View>
              ))}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <IconTile name="check" />
            <AppText variant="headline">{t('accuracy.labelsTitle')}</AppText>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
            <LabelChip word={t('evidence.checked')} fg={colors.badgeCheckedFg} bg={colors.badgeCheckedBg} />
            <LabelChip word={t('evidence.publicData')} fg={colors.badgePublicFg} bg={colors.badgePublicBg} />
            <LabelChip word={t('evidence.experimental')} fg={colors.badgeFlagFg} bg={colors.badgeFlagBg} />
            <LabelChip
              word={t('evidence.notTested')}
              fg={colors.badgeExperimentalFg}
              bg={colors.badgeExperimentalBg}
            />
          </View>
          <AppText variant="subheadline" tone="textDim" style={{ marginTop: spacing.xs }}>
            {t('evidence.experimental.explain')}
          </AppText>
        </Card>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
            <IconTile name="hint" />
            <AppText variant="subheadline" tone="textDim" style={{ flex: 1 }}>
              {t('accuracy.falseAlarms')}
            </AppText>
          </View>
        </Card>
        <View style={{ gap: spacing.xs, paddingHorizontal: spacing.sm }}>
          <AppText variant="caption" tone="textFaint">
            {t('prototype.banner')}
          </AppText>
          {date ? (
            <AppText variant="caption" tone="textFaint">
              {t('accuracy.evidenceDate', { date })}
            </AppText>
          ) : null}
        </View>
      </View>
    </RouteShell>
  );
}

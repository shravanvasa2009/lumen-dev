import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Confidence, QualityReason } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import type { IconName } from '@/components/Icon';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { CheckHeading } from './CheckHeading';
import { ConfidenceDots } from './ConfidenceDots';
import { LowerQualityTag } from './LowerQualityTag';

type MetricCardProps = {
  title: string;
  // The short check name shown before the title, e.g. "AFib · Heart rhythm".
  checkName?: string;
  icon: IconName;
  evidenceMetric: EvidenceMetric;
  // §11.10: scored by the fallback rule, so the card says so and its evidence is Experimental.
  basicAnalysis?: boolean;
  // Null when the metric missed its clean-data floor; that card alone says so (§6.2).
  reading: { value: string; note: string; confidence: Confidence; flagged: boolean } | null;
  // What a null reading says when the check did not run at all, instead of "Not enough clean signal".
  missingText?: string;
  // Set when this metric's quality is low; the card then carries the small tag.
  lowQualityReasons?: readonly QualityReason[] | null;
  // A line under the result, e.g. the advice to confirm a low-quality irregular rhythm.
  footnote?: string;
};

export function MetricCard({
  title,
  checkName,
  icon,
  evidenceMetric,
  basicAnalysis = false,
  reading,
  missingText,
  lowQualityReasons,
  footnote,
}: MetricCardProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  // Measured, not left to flex wrapping: on the Galaxy A17 a wrapping row still squeezed "AFib · Heart rhythm"
  // to a letter-wide column beside the Flag, Experimental and dots badges (owner, 2026-10-09). When the name's
  // natural width and the badges don't fit on one line, the badges get their own line under the name,
  // left-aligned with the tag below them.
  const [rowWidth, setRowWidth] = useState(0);
  const [nameWidth, setNameWidth] = useState(0);
  const [badgesWidth, setBadgesWidth] = useState(0);
  const stacked = reading !== null && rowWidth > 0 && nameWidth + spacing.sm + badgesWidth > rowWidth;
  return (
    <Card>
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={
          stacked
            ? { gap: spacing.sm }
            : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }
        }
      >
        <View
          onLayout={(event) => setNameWidth(event.nativeEvent.layout.width)}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', opacity: 0, flexDirection: 'row' }}
        >
          <CheckHeading icon={icon} name={checkName} label={title} />
        </View>
        <CheckHeading icon={icon} name={checkName} label={title} />
        {reading ? (
          <View
            onLayout={(event) => setBadgesWidth(event.nativeEvent.layout.width)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: stacked ? 'flex-start' : 'auto',
              gap: spacing.sm,
              flexShrink: 0,
            }}
          >
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
            <EvidenceBadge metric={evidenceMetric} basicAnalysis={basicAnalysis} />
            <ConfidenceDots confidence={reading.confidence} />
          </View>
        ) : null}
      </View>
      {reading && lowQualityReasons ? <LowerQualityTag small reasons={lowQualityReasons} /> : null}
      {reading ? (
        // Wraps so a long value ("Too short to judge the rhythm") pushes the note to its own line; without
        // wrap the note was squeezed to a one-letter column the height of the screen.
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            columnGap: spacing.sm,
          }}
        >
          <AppText variant="title" style={{ flexShrink: 1 }}>
            {reading.value}
          </AppText>
          <AppText tone="textDim" style={{ flexGrow: 1, textAlign: 'right' }}>
            {reading.note}
          </AppText>
        </View>
      ) : (
        <AppText variant="headline">{missingText ?? t('result.inconclusive')}</AppText>
      )}
      {reading && basicAnalysis ? (
        <AppText variant="caption" tone="textDim">
          {t('results.basicAnalysis')}
        </AppText>
      ) : null}
      {reading && footnote ? <AppText tone="textDim">{footnote}</AppText> : null}
    </Card>
  );
}

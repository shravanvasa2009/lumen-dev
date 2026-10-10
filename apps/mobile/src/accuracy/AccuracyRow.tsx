import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { accuracyLines } from './accuracyLines';
import type { AccuracyFigures } from './readAccuracy';

// Card padding 16 + tile 36 + gap 12, so details line up under the heading text.
const DETAIL_INDENT = 64;

type AccuracyRowProps = {
  metric: EvidenceMetric;
  heading: string;
  icon: IconName;
  figures: AccuracyFigures;
  last: boolean;
};

export function AccuracyRow({ metric, heading, icon, figures, last }: AccuracyRowProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const [open, setOpen] = useState(false);
  const { headline, details } = accuracyLines(metric, figures, t, i18n.language);
  return (
    <View
      style={{
        borderBottomColor: colors.line,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[styles.headingRow, { gap: spacing.md, padding: spacing.lg, minHeight: control.minTarget }]}
      >
        <View style={[styles.tile, { backgroundColor: colors.accentTint }]}>
          <Icon name={icon} size={20} color={colors.accent} />
        </View>
        <View style={[styles.text, { gap: spacing.xs }]}>
          <AppText variant="headline">{heading}</AppText>
          <View style={[styles.headingRow, styles.wrap, { gap: spacing.sm }]}>
            <AppText variant="subheadline" tone="textDim">
              {headline}
            </AppText>
            <EvidenceBadge metric={metric} showExperimental />
          </View>
        </View>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={14} color={colors.textFaint} />
        </View>
      </PressableScale>
      {open ? (
        <View
          style={{
            paddingLeft: DETAIL_INDENT,
            paddingRight: spacing.lg,
            paddingBottom: spacing.lg,
            gap: spacing.xs,
          }}
        >
          {details.map((line) => (
            <AppText key={line} variant="caption" tone="textDim">
              {line}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0 },
  wrap: { flexWrap: 'wrap' },
  tile: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});

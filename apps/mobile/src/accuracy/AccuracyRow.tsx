import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { accuracyLines } from './accuracyLines';
import type { AccuracyFigures } from './readAccuracy';

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
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[styles.headingRow, { gap: spacing.md, padding: spacing.lg, minHeight: control.minTarget }]}
      >
        <View style={[styles.icon, { backgroundColor: colors.surface2 }]}>
          <Icon name={icon} size={20} color={colors.textDim} />
        </View>
        <View style={styles.text}>
          <AppText variant="headline">{heading}</AppText>
          <View style={[styles.headingRow, { gap: spacing.sm }]}>
            <AppText tone="textDim" style={styles.text}>
              {headline}
            </AppText>
            <EvidenceBadge metric={metric} />
          </View>
        </View>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={control.chevronSize} color={colors.textDim} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs }}>
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
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});

import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { QualityReason } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

import { LowerQualityTag } from './LowerQualityTag';

type MeasureRowProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  // Null when the check gave no value: the row then shows only its reason in the subtitle.
  value: { text: string; unit?: string } | null;
  flagged?: boolean;
  // A flag on a lower-quality value stays visible but wears the neutral pill instead of the amber one (ADR 0104).
  quietFlag?: boolean;
  lowQualityReasons?: readonly QualityReason[] | null;
  footnote?: string;
  last?: boolean;
};

// One line of the Measurements list: icon, name with its note under it, and the value at the right.
export function MeasureRow({
  icon,
  title,
  subtitle,
  value,
  flagged = false,
  quietFlag = false,
  lowQualityReasons,
  footnote,
  last = false,
}: MeasureRowProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingLeft: spacing.lg,
      }}
    >
      <View style={{ width: 28, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={colors.accent} />
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 64,
          paddingVertical: spacing.md,
          paddingRight: spacing.lg,
          gap: spacing.xs,
          borderBottomColor: colors.line,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <AppText variant="headline" style={{ fontWeight: '400' }}>
                {title}
              </AppText>
              {flagged ? (
                <View
                  style={{
                    backgroundColor: quietFlag ? colors.badgeExperimentalBg : colors.badgeFlagBg,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.sm,
                  }}
                >
                  <AppText
                    variant="caption"
                    style={{ color: quietFlag ? colors.badgeExperimentalFg : colors.badgeFlagFg }}
                  >
                    {t('results.flag')}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText tone="textDim">{subtitle}</AppText>
          </View>
          {value ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: spacing.xs,
                flexShrink: 1,
                maxWidth: '50%',
              }}
            >
              <AppText variant="vitalS" style={{ textAlign: 'right' }}>
                {value.text}
              </AppText>
              {value.unit ? (
                <AppText tone="textDim" style={{ fontWeight: '500' }}>
                  {value.unit}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>
        {lowQualityReasons ? <LowerQualityTag small reasons={lowQualityReasons} /> : null}
        {footnote ? (
          <AppText variant="caption" tone="textDim">
            {footnote}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

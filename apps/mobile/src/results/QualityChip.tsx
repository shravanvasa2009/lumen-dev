import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { type QualityReason, reasonText } from './quality';

type QualityChipProps = { reasons: readonly QualityReason[]; small?: boolean };

const tipKeys = ['quality.tipFlat', 'quality.tipStill', 'quality.tipWarm', 'quality.tipFull'] as const;

// §6: a reading is never withheld for quality; this quiet amber-neutral tag says it was weaker, and the
// sheet says why. Never red (SAFE-1).
export function QualityChip({ reasons, small = false }: QualityChipProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quality.chip')}
        accessibilityHint={t('quality.chipHint')}
        hitSlop={spacing.md}
        onPress={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          backgroundColor: colors.badgeFlagBg,
          borderRadius: radius.pill,
          paddingHorizontal: small ? spacing.sm : spacing.md,
          paddingVertical: small ? 0 : spacing.xs,
        }}
      >
        <AppText variant="caption" style={{ color: colors.badgeFlagFg }}>
          {t('quality.chip')} ›
        </AppText>
      </Pressable>
      <BottomSheet visible={open} onDismiss={() => setOpen(false)} dismissLabel={t('common.close')}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.lg }}>
          <AppText variant="title" accessibilityRole="header">
            {t('quality.sheetTitle')}
          </AppText>
          <View style={{ gap: spacing.sm }}>
            {reasons.map((reason) => (
              <AppText key={reason.kind}>• {reasonText(t, reason)}</AppText>
            ))}
          </View>
          <AppText variant="headline">{t('quality.betterTitle')}</AppText>
          <View style={{ gap: spacing.sm }}>
            {tipKeys.map((key) => (
              <AppText key={key} tone="textDim">
                • {t(key)}
              </AppText>
            ))}
          </View>
        </ScrollView>
        <Button label={t('common.gotIt')} variant="secondary" onPress={() => setOpen(false)} />
      </BottomSheet>
    </>
  );
}

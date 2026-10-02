import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ReadingResult } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { ListRow } from '@/components/ListRow';
import { useTheme } from '@/theme';

type ExperimentalCardProps = {
  experimental: ReadingResult['experimental'];
  // True when the diabetes estimate sits here because it has not cleared the accuracy floor (mockup 16b).
  showDiabetes: boolean;
};

// §6.3: grey badges, no flags. Collapsed by default; the row opens the extra-beats and pulse-shape detail.
export function ExperimentalCard({ experimental, showDiabetes }: ExperimentalCardProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const total = showDiabetes ? 3 : 2;
  return (
    <Card flush>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          padding: spacing.lg,
        }}
      >
        <AppText tone="textDim" style={{ flex: 1 }}>
          {t('results.experimentalCount', { total })}
        </AppText>
        <EvidenceBadge metric="extraBeats" />
      </View>
      {showDiabetes ? (
        <View
          style={{
            borderTopColor: colors.line,
            borderTopWidth: 1,
            padding: spacing.lg,
            gap: spacing.xs,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="headline">{t('dm.flag.title')}</AppText>
            <EvidenceBadge metric="diabetes" />
          </View>
          <AppText tone="textDim">{t('dm.experimental')}</AppText>
        </View>
      ) : null}
      <View style={{ borderTopColor: colors.line, borderTopWidth: 1 }}>
        <ListRow
          title={t('results.extraAndShape')}
          chevron
          last={!open}
          onPress={() => setOpen((wasOpen) => !wasOpen)}
        />
      </View>
      {open ? (
        <View style={{ padding: spacing.lg, paddingTop: 0, gap: spacing.xs }}>
          <AppText>{t('results.extraBeatsRate', { rate: experimental.extraBeatsPerMin })}</AppText>
          <AppText>
            {experimental.pulseShape.available ? t('results.shapeAvailable') : t('results.shapeUnavailable')}
          </AppText>
          <AppText variant="caption" tone="textDim">
            {t('results.notHealthMeasurement')}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

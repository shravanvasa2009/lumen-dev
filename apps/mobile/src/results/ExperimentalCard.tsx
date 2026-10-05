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
};

// §6.3: grey badges, no flags. Collapsed by default; the row opens the extra-beats and pulse-shape detail.
export function ExperimentalCard({ experimental }: ExperimentalCardProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState(false);
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
          {t('results.experimentalCount', { total: 2 })}
        </AppText>
        <EvidenceBadge metric="extraBeats" />
      </View>
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
          <AppText>{t('results.extraBeatsRate', { rate: Math.round(experimental.extraBeatsPerMin * 10) / 10 })}</AppText>
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

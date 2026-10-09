import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Card';
import { ValueSettle } from '@/components/Reveal';
import { useTheme } from '@/theme';

import { Sparkline } from './Sparkline';

// The 360 x 640 layout trades sparkline height for room (mockup 10-home.small).
const SPARKLINE_COMPACT = 16;

type MetricTileProps = { label: string; unit: string; points: readonly number[]; compact?: boolean };

export function MetricTile({ label, unit, points, compact = false }: MetricTileProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const latest = points.at(-1);
  const value = latest === undefined ? t('home.noValue') : String(Math.round(latest));
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${latest === undefined ? t('home.noReadingsShort') : `${value} ${unit}`}`}
      onPress={() => router.push('/trends')}
      style={{ flex: 1 }}
    >
      <Card dense={compact}>
        <AppText variant="caption" tone="textDim">
          {label}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
          <ValueSettle value={value}>
            <AppText variant="title">{value}</AppText>
          </ValueSettle>
          {latest === undefined ? null : (
            <AppText variant="caption" tone="textDim">
              {unit}
            </AppText>
          )}
        </View>
        <View style={{ minHeight: compact ? SPARKLINE_COMPACT : 32 }}>
          <Sparkline points={points} height={compact ? SPARKLINE_COMPACT : undefined} />
        </View>
      </Card>
    </PressableScale>
  );
}

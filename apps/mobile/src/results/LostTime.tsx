import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { LostSeconds } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme';

type LostCause = 'movement' | 'pressure' | 'light';

// Light leaking around the finger is counted as coverage; cold hands have no row in mockup 19.
function secondsLost(lost: LostSeconds, cause: LostCause): number {
  return { movement: lost.motion, pressure: lost.pressure, light: lost.coverage }[cause];
}

const lostCauses: readonly LostCause[] = ['movement', 'pressure', 'light'];

// Whole-number shares that add to 100, so the legend never reads 99% or 101%: round every share down, then give
// each point still missing to the shares with the largest fractional part.
function percentShares(seconds: readonly number[]): number[] {
  const total = seconds.reduce((sum, value) => sum + value, 0);
  const exact = seconds.map((value) => (value / total) * 100);
  const shares = exact.map(Math.floor);
  const missing = 100 - shares.reduce((sum, value) => sum + value, 0);
  const largestFractionFirst = exact
    .map((value, index) => ({ index, fraction: value - shares[index]! }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of largestFractionFirst.slice(0, missing)) shares[index]!++;
  return shares;
}

// Without a lost-time breakdown there is nothing to explain, so the card is left out.
export function LostTime({ lost }: { lost: LostSeconds | null }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  if (!lost) return null;
  const seconds = lostCauses.map((cause) => secondsLost(lost, cause));
  if (seconds.every((value) => value <= 0)) return null;
  const names = {
    movement: t('inconclusive.movement'),
    pressure: t('inconclusive.pressure'),
    light: t('inconclusive.light'),
  };
  // Red is reserved for the emergency screen (SAFE-1), so Pressure keeps the accent teal, not mockup 19's red.
  const shades = { movement: colors.flag, pressure: colors.accent, light: colors.badgePublicFg };
  const percents = percentShares(seconds);
  return (
    <Card>
      <AppText tone="textDim">{t('inconclusive.where')}</AppText>
      <View
        testID="lost-time-bar"
        style={{
          flexDirection: 'row',
          height: 10,
          borderRadius: radius.pill,
          overflow: 'hidden',
          backgroundColor: colors.line,
        }}
      >
        {lostCauses.map((cause, index) =>
          seconds[index]! > 0 ? (
            <View key={cause} style={{ flex: seconds[index], backgroundColor: shades[cause] }} />
          ) : null,
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs }}>
        {lostCauses.map((cause, index) => (
          <View key={cause} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shades[cause] }} />
            <AppText variant="caption" tone="textDim">
              {t('inconclusive.rowPercent', { label: names[cause], percent: percents[index] })}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

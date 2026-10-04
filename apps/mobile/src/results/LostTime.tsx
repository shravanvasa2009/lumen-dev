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

// With no reading to explain, the causes are listed without seconds.
export function LostTime({ lost }: { lost: LostSeconds | null }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const names = {
    movement: t('inconclusive.movement'),
    pressure: t('inconclusive.pressure'),
    light: t('inconclusive.light'),
  };
  const shades = { movement: colors.flag, pressure: colors.accent, light: colors.badgePublicFg };
  const total = lost ? lostCauses.reduce((sum, cause) => sum + secondsLost(lost, cause), 0) : 0;
  return (
    <Card>
      <AppText tone="textDim">{t('inconclusive.where')}</AppText>
      {lost && total > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            height: 10,
            borderRadius: radius.pill,
            overflow: 'hidden',
            backgroundColor: colors.line,
          }}
        >
          {lostCauses
            .filter((cause) => secondsLost(lost, cause) > 0)
            .map((cause) => (
              <View key={cause} style={{ flex: secondsLost(lost, cause), backgroundColor: shades[cause] }} />
            ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs }}>
        {lostCauses.map((cause) => (
          <View key={cause} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shades[cause] }} />
            <AppText variant="caption" tone="textDim">
              {lost
                ? t('inconclusive.rowSeconds', { label: names[cause], seconds: Math.round(secondsLost(lost, cause)) })
                : names[cause]}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

import type { RhythmClass } from '@lumen/core';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { intervalAxis } from '@/results/axis';
import { PoincarePlot } from '@/results/PoincarePlot';
import { useTheme } from '@/theme';

export type RhythmDay = {
  id: string;
  day: string;
  rhythm: RhythmClass | null;
  lowerQuality: boolean;
  intervalsMs: readonly number[];
};

const tileSize = 64;

// A beat-to-beat map needs the recorded intervals. A reading saved before they were kept has none, so its tile
// shows the rhythm symbol and opens the reading instead of drawing points that were never measured.
export function RhythmOverTime({ days }: { days: readonly RhythmDay[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View>
        <AppText variant="title3" accessibilityRole="header">
          {t('trends.rhythmTitle')}
        </AppText>
        <AppText variant="subheadline" tone="textDim" style={{ marginTop: spacing.xs }}>
          {t('trends.rhythmHint')}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {days.map(({ id, day, rhythm, lowerQuality, intervalsMs }) => {
          const flagged = rhythm !== null && rhythm !== 'sinus';
          const word =
            rhythm === 'sinus'
              ? t('trends.rhythmSteady')
              : rhythm === null
                ? t('trends.rhythmShort')
                : t('trends.rhythmNotSteady');
          const plotColor = flagged ? colors.flag : colors.accentFill;
          return (
            <PressableScale
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`${day}: ${lowerQuality ? t('quality.marked', { value: word }) : word}`}
              onPress={() => router.push(intervalsMs.length > 0 ? `/results/${id}/why` : `/results/${id}`)}
              style={{ width: tileSize, alignItems: 'center' }}
            >
              <View
                style={{
                  width: tileSize,
                  height: tileSize,
                  borderRadius: 14,
                  overflow: 'hidden',
                  backgroundColor: colors.plotPanel,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {intervalsMs.length > 1 ? (
                  <PoincarePlot
                    intervalsMs={intervalsMs}
                    axis={intervalAxis(intervalsMs)}
                    color={plotColor}
                    label={word}
                  />
                ) : (
                  <Icon name="rhythm" size={32} color={plotColor} />
                )}
              </View>
              <AppText variant="caption" style={{ fontWeight: '600', marginTop: spacing.sm }}>
                {day}
              </AppText>
              <AppText
                variant="caption1"
                tone="textDim"
                numberOfLines={1}
                style={flagged ? { color: colors.flag } : undefined}
              >
                {word}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

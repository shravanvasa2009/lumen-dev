import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

import type { Band } from './baseline';

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 48;
const SPARK_INSET = 3;

type OtherMetricTileProps = {
  name: string;
  icon: IconName;
  unit: string;
  // The latest value in the range, already rounded; null when the range has none.
  value: number | null;
  when: string | null;
  sparkline: readonly number[];
  band: Band | null;
  onPress: () => void;
};

// Shows a metric the chart above is not plotting; pressing it moves the chart to that metric.
export function OtherMetricTile({
  name,
  icon,
  unit,
  value,
  when,
  sparkline,
  band,
  onPress,
}: OtherMetricTileProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing, shadow } = useTheme();
  const scaled = band ? [...sparkline, band.low, band.high] : sparkline;
  const low = Math.min(...scaled);
  const span = Math.max(...scaled) - low || 1;
  const yFor = (point: number) =>
    SPARK_HEIGHT - SPARK_INSET - ((point - low) / span) * (SPARK_HEIGHT - 2 * SPARK_INSET);
  const xFor = (index: number) =>
    SPARK_INSET + (index / (sparkline.length - 1)) * (SPARK_WIDTH - 2 * SPARK_INSET);
  const lastIndex = sparkline.length - 1;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value === null ? t('trends.noneInRange') : `${value} ${unit}`}`}
      onPress={onPress}
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.sheet, padding: spacing.lg },
        shadow.raised,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={17} color={colors.accent} />
        <AppText variant="caption" tone="accent" style={{ flex: 1, fontWeight: '600' }}>
          {name}
        </AppText>
        {when ? (
          <AppText variant="caption" tone="textDim">
            {when}
          </AppText>
        ) : null}
        <Icon name="chevron" size={14} color={colors.textFaint} />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginTop: 10,
          gap: spacing.md,
        }}
      >
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
          <AppText variant="vitalM">{value === null ? '—' : String(value)}</AppText>
          {value === null ? null : (
            <AppText variant="subheadline" tone="textDim" style={{ fontWeight: '500' }}>
              {unit}
            </AppText>
          )}
        </View>
        {sparkline.length > 1 ? (
          <Svg width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}>
            {band ? (
              <Rect
                x={0}
                y={yFor(band.high)}
                width={SPARK_WIDTH}
                height={yFor(band.low) - yFor(band.high)}
                rx={4}
                fill={colors.accentTint}
              />
            ) : null}
            <Polyline
              points={sparkline.map((point, index) => `${xFor(index)},${yFor(point)}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={xFor(lastIndex)} cy={yFor(sparkline[lastIndex]!)} r={3} fill={colors.accent} />
          </Svg>
        ) : null}
      </View>
    </PressableScale>
  );
}

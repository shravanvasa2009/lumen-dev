import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

import { BandLegend } from './HeartRateDial';
import { TickedDial } from './TickedDial';

type DialTileProps = {
  icon: IconName;
  title: string;
  // Null when the check gave no value: the dial stays empty and `caption` says why.
  value: number | null;
  unit: string;
  scale: { min: number; max: number; step: number; majorEvery: number };
  band: readonly [number, number] | null;
  caption: string;
  // The range under the caption, already worded ("35–58 ms"); absent while there is no band to show.
  legend?: string;
  // The confidence word, so a tile states how sure the check was as the list rows do.
  confidence?: string;
  label: string;
};

// One half-width tile under the hero: icon and name, an 88 px ticked dial with the value inside, and a
// one-line verdict with its range.
export function DialTile({
  icon,
  title,
  value,
  unit,
  scale,
  band,
  caption,
  legend,
  confidence,
  label,
}: DialTileProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.sheet,
        paddingVertical: spacing.md + 2,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.chip,
            backgroundColor: colors.buttonFill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={colors.onButtonFill} />
        </View>
        <AppText variant="subheadline" style={{ flex: 1, fontWeight: '600' }} numberOfLines={2}>
          {title}
        </AppText>
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <TickedDial size="mini" {...scale} value={value} band={band} label={label}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center' }]}>
            <AppText
              importantForAccessibility="no"
              style={{
                marginTop: 24,
                fontSize: 26,
                lineHeight: 28,
                fontWeight: '600',
                fontVariant: ['tabular-nums'],
              }}
            >
              {value === null ? '–' : String(Math.round(value))}
            </AppText>
            <AppText
              importantForAccessibility="no"
              variant="caption2"
              tone="textDim"
              style={{ marginTop: 0 }}
            >
              {unit}
            </AppText>
          </View>
        </TickedDial>
      </View>
      <AppText
        variant="caption"
        style={{ marginTop: spacing.sm - 2, fontWeight: '600', textAlign: 'center' }}
      >
        {caption}
      </AppText>
      {legend ? <BandLegend text={legend} swatchWidth={12} swatchHeight={5} /> : null}
      {confidence ? (
        <AppText variant="caption1" tone="textDim" style={{ textAlign: 'center' }}>
          {confidence}
        </AppText>
      ) : null}
    </View>
  );
}

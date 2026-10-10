import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { type UsualBand } from './usualBand';
import { TickedDial } from './TickedDial';

const MIN_BPM = 40;
const MAX_BPM = 120;

// The range note under the dial: a swatch the colour of the shaded arc, then the numbers.
export function BandLegend({
  text,
  swatchWidth,
  swatchHeight,
}: {
  text: string;
  swatchWidth: number;
  swatchHeight: number;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm - 2 }}>
      <View
        style={{
          width: swatchWidth,
          height: swatchHeight,
          borderRadius: swatchHeight / 2,
          backgroundColor: colors.accent,
          opacity: 0.3,
        }}
      />
      <AppText
        variant={swatchHeight > 5 ? 'caption' : 'caption1'}
        tone="textDim"
        style={{ fontWeight: '500' }}
      >
        {text}
      </AppText>
    </View>
  );
}

type HeartRateDialProps = { bpm: number; band: UsualBand | null };

// The hero of Results: the heart rate on a 40 to 120 bpm dial, the usual band shaded, the number inside.
export function HeartRateDial({ bpm, band }: HeartRateDialProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const bandRange = band ? ([band.low, band.high] as const) : null;
  const bandText = !band
    ? null
    : band.personal
      ? t('results.usualRange', { low: band.low, high: band.high })
      : t('results.typicalRange', { low: band.low, high: band.high });
  const label = t('results.ringLabel', { value: bpm });
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm - 2 }}>
      <TickedDial
        size="hero"
        min={MIN_BPM}
        max={MAX_BPM}
        step={2}
        majorEvery={5}
        value={bpm}
        band={bandRange}
        label={label}
        showEnds
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={{ position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center' }}>
            <Svg width={40} height={14} viewBox="0 0 40 14">
              <Path
                d="M1 8h9l2.5-5 3.5 10 3-7 2 2h9"
                fill="none"
                stroke={colors.pulse}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Circle cx={34} cy={8} r={5} fill={colors.pulse} fillOpacity={0.22} />
              <Circle cx={34} cy={8} r={2.25} fill={colors.pulse} />
            </Svg>
          </View>
          <AppText
            importantForAccessibility="no"
            variant="vitalXL"
            style={{ position: 'absolute', top: 68, left: 0, right: 0, textAlign: 'center' }}
          >
            {String(bpm)}
          </AppText>
          <AppText
            importantForAccessibility="no"
            tone="textDim"
            style={{
              position: 'absolute',
              top: 134,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontWeight: '500',
            }}
          >
            {t('results.unitBpm')}
          </AppText>
        </View>
      </TickedDial>
      {bandText ? <BandLegend text={bandText} swatchWidth={18} swatchHeight={6} /> : null}
    </View>
  );
}

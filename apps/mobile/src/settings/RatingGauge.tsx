import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const SIZE = 220;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CENTER = SIZE / 2;
// The ring opens at the bottom: it starts 150 degrees clockwise from the right and sweeps 240 degrees.
const START_DEGREES = 150;
const SWEEP_DEGREES = 240;
const MAX_SCORE = 100;

function pointAt(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return `${CENTER + RADIUS * Math.cos(radians)} ${CENTER + RADIUS * Math.sin(radians)}`;
}

function arcPath(sweepDegrees: number) {
  const largeArc = sweepDegrees > 180 ? 1 : 0;
  return `M ${pointAt(START_DEGREES)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${pointAt(START_DEGREES + sweepDegrees)}`;
}

const ringPath = arcPath(SWEEP_DEGREES);

type RatingGaugeProps = {
  // The big label: the score, or the placeholder dash while there is none.
  label: string;
  caption: string;
  // 0 to 100. Null draws the empty ring: no score exists until the phone has been rated.
  score: number | null;
};

export function RatingGauge({ label, caption, score }: RatingGaugeProps) {
  const { colors } = useTheme();
  const filledDegrees =
    score === null ? 0 : (Math.min(Math.max(score, 0), MAX_SCORE) / MAX_SCORE) * SWEEP_DEGREES;
  return (
    <View accessible accessibilityLabel={`${label}, ${caption}`} style={styles.gauge}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} accessibilityElementsHidden>
        <Path d={ringPath} stroke={colors.surface3} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
        {filledDegrees > 0 ? (
          <Path
            d={arcPath(filledDegrees)}
            stroke={colors.accentFill}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={styles.label}>
        <AppText variant="display" tone={score === null ? 'textDim' : 'text'}>
          {label}
        </AppText>
        <AppText variant="headline" tone={score === null ? 'textDim' : 'accent'}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gauge: { width: SIZE, height: SIZE * 0.8, alignSelf: 'center', overflow: 'hidden' },
  label: { position: 'absolute', top: SIZE * 0.3, left: 0, right: 0, alignItems: 'center' },
});

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
const END_DEGREES = 30;

function pointAt(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return `${CENTER + RADIUS * Math.cos(radians)} ${CENTER + RADIUS * Math.sin(radians)}`;
}

const ringPath = `M ${pointAt(START_DEGREES)} A ${RADIUS} ${RADIUS} 0 1 1 ${pointAt(END_DEGREES)}`;

// Draws the empty ring: no score exists until the phone check has run on this phone.
export function RatingGauge({ placeholder, caption }: { placeholder: string; caption: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.gauge}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} accessibilityElementsHidden>
        <Path d={ringPath} stroke={colors.surface3} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
      </Svg>
      <View style={styles.label}>
        <AppText variant="display" tone="textDim">
          {placeholder}
        </AppText>
        <AppText variant="headline" tone="textDim">
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

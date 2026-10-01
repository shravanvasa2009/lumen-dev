import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const WIDTH = 280;
const STROKE = 18;
const RADIUS = (WIDTH - STROKE) / 2;
const HEIGHT = RADIUS + STROKE;
const SCORE_MAX = 100;
// Left end to right end over the top of the dial.
const ARC = `M ${STROKE / 2} ${RADIUS + STROKE / 2} A ${RADIUS} ${RADIUS} 0 0 1 ${WIDTH - STROKE / 2} ${RADIUS + STROKE / 2}`;

// score is the 0-100 Lumen rating (spec §5.1), or null while the phone has not been rated.
export function RatingGauge({ score }: { score: number | null }) {
  const { colors } = useTheme();
  const arcLength = Math.PI * RADIUS;
  const filled = score === null ? 0 : (Math.min(score, SCORE_MAX) / SCORE_MAX) * arcLength;
  return (
    <View style={{ width: WIDTH, height: HEIGHT, alignSelf: 'center', alignItems: 'center' }}>
      <Svg
        width={WIDTH}
        height={HEIGHT}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path d={ARC} stroke={colors.surface3} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
        {filled > 0 ? (
          <Path
            d={ARC}
            stroke={colors.accent}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${filled} ${arcLength}`}
          />
        ) : null}
      </Svg>
      <AppText variant="display" style={{ position: 'absolute', bottom: 0 }}>
        {score === null ? '—' : String(score)}
      </AppText>
    </View>
  );
}

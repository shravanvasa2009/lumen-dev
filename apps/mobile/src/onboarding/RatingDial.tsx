import { View } from 'react-native';
import Svg, { Circle, Defs, G, Mask } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

// Drawn in mockup 08's 200-unit square.
const BOX = 200;
const RADIUS = 92;
const TICK = 2;
const TICK_GAP = 6.85;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// The ring opens at the bottom: 270 degrees of ticks, starting at the lower left.
const ARC_LENGTH = 436.54;
const START_DEGREES = 134.38;
const MASK_STROKE = 14;
const MAX_SCORE = 100;

type RatingDialProps = {
  // 0 to 100, or null while there is no score: the ring then shows only its unlit ticks.
  score: number | null;
  // The big text in the middle: the score, or a dash.
  label: string;
  caption: string;
  size?: number;
};

// The score as a ring of ticks with the number centred in it and the tier in the gap at the bottom.
export function RatingDial({ score, label, caption, size = BOX }: RatingDialProps) {
  const { colors } = useTheme();
  const scale = size / BOX;
  const litLength = score === null ? 0 : (Math.min(Math.max(score, 0), MAX_SCORE) / MAX_SCORE) * ARC_LENGTH;
  const arcMask = (id: string, length: number) => (
    <Mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={BOX} height={BOX}>
      <Circle
        cx={BOX / 2}
        cy={BOX / 2}
        r={RADIUS}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={MASK_STROKE}
        strokeDasharray={`${length} ${CIRCUMFERENCE}`}
      />
    </Mask>
  );
  const ticks = (stroke: string, maskId: string) => (
    <Circle
      cx={BOX / 2}
      cy={BOX / 2}
      r={RADIUS}
      fill="none"
      stroke={stroke}
      strokeWidth={10}
      strokeDasharray={`${TICK} ${TICK_GAP}`}
      mask={`url(#${maskId})`}
    />
  );
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}, ${caption}`}
      style={{ width: size, height: size, alignSelf: 'center' }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`} accessibilityElementsHidden>
        <Defs>
          {arcMask('rating-track', ARC_LENGTH)}
          {arcMask('rating-lit', litLength)}
        </Defs>
        <G rotation={START_DEGREES} origin={`${BOX / 2}, ${BOX / 2}`}>
          {ticks(colors.surface3, 'rating-track')}
          {litLength > 0 ? ticks(colors.accent, 'rating-lit') : null}
        </G>
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
        <AppText
          variant="vitalXL"
          tone={score === null ? 'textDim' : 'text'}
          style={{ textAlign: 'center', fontSize: 64 * scale, lineHeight: 68 * scale }}
        >
          {label}
        </AppText>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 162 * scale, alignItems: 'center' }}>
        <AppText variant="headline" tone={score === null ? 'textDim' : 'accent'}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const SIZE = 112;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// One track circle and one round-capped arc, so the ring has no segment seams. The track is the Experimental
// share; the arc is the share that passed. A zero arc is not drawn: a round cap on zero length would leave a dot.
export function CheckedRing({ checked, total }: { checked: number; total: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const arcLength = total === 0 ? 0 : (CIRCUMFERENCE * checked) / total;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('accuracy.summary', { checked, total })}
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute' }}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colors.flagFill}
          strokeWidth={STROKE}
        />
        {arcLength > 0 ? (
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={colors.buttonFill}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        ) : null}
      </Svg>
      <AppText variant="vitalM" style={{ lineHeight: 36 }}>
        {checked}
      </AppText>
      <AppText variant="caption1" tone="textDim" style={{ fontWeight: '600', lineHeight: 14 }}>
        {t('accuracy.ringOf', { total })}
      </AppText>
      <AppText variant="caption1" tone="textDim" style={{ fontWeight: '600', lineHeight: 14 }}>
        {t('accuracy.ringChecked')}
      </AppText>
    </View>
  );
}

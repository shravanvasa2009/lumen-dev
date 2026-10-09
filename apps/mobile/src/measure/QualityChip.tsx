import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { ValueSettle } from '@/components/Reveal';
import { labelAt } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';
import { enterTransition, glideConfig, useReduceMotion } from '@/theme/motion';

const BAR_WIDTH = 4;
const BAR_HEIGHT = 11;
const DIM_OPACITY = 0.3;
const BARS = { weak: 1, ok: 2, strong: 3 } as const;

// One of the three bars; it eases between lit and dim as the level moves, on the UI thread.
function QualityBar({ lit }: { lit: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const glide = glideConfig(reduceMotion);
  const barStyle = useAnimatedStyle(() => ({ opacity: withTiming(lit ? 1 : DIM_OPACITY, glide) }));
  return (
    <Animated.View
      style={[
        { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: 1, backgroundColor: colors.badgeCheckedFg },
        barStyle,
      ]}
    />
  );
}

// "Quality ▮▮▮ Good" from the same Weak/OK/Strong level the practice meter shows. With no level (`checking`: the
// camera runs but the session has no pulse window yet) it reads "Checking" with no bar lit, instead of a level
// nobody measured; with neither a level nor `checking` it is left out.
// `compact` drops the word "Quality" (the screen reader still says it) so the header leaves room for the title on
// a 360 dp phone, where "Escaneo completo" and the full chip do not fit side by side.
export function QualityChip({
  level,
  checking = false,
  compact = false,
  onLayout,
}: {
  level: number | null;
  checking?: boolean;
  compact?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const band = labelAt(level);
  if (band === null && !checking) return null;
  const word =
    band === null
      ? t('capture.qualityChecking')
      : { weak: t('signal.weak'), ok: t('signal.ok'), strong: t('capture.qualityGood') }[band];
  return (
    <Animated.View
      entering={enterTransition(reduceMotion)}
      accessible
      accessibilityLabel={`${t('capture.quality')} ${word}`}
      onLayout={onLayout}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: compact ? spacing.sm : spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: colors.badgeCheckedBg,
      }}
    >
      {compact ? null : (
        <AppText variant="caption" style={{ fontWeight: '600', color: colors.badgeCheckedFg }}>
          {t('capture.quality')}
        </AppText>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityElementsHidden>
        {[1, 2, 3].map((barNumber) => (
          <QualityBar key={barNumber} lit={band !== null && barNumber <= BARS[band]} />
        ))}
      </View>
      <ValueSettle value={word}>
        <AppText variant="caption" style={{ fontWeight: '600', color: colors.badgeCheckedFg }}>
          {word}
        </AppText>
      </ValueSettle>
    </Animated.View>
  );
}

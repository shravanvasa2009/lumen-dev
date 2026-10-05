import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { labelAt } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

const BAR_WIDTH = 4;
const BAR_HEIGHT = 11;
const BARS = { weak: 1, ok: 2, strong: 3 } as const;

// "Quality ▮▮▮ Good" from the same Weak/OK/Strong level the practice meter shows; left out until there is one.
export function QualityChip({
  level,
  onLayout,
}: {
  level: number | null;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const band = labelAt(level);
  if (band === null) return null;
  const word = { weak: t('signal.weak'), ok: t('signal.ok'), strong: t('capture.qualityGood') }[band];
  return (
    <View
      accessible
      accessibilityLabel={`${t('capture.quality')} ${word}`}
      onLayout={onLayout}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: colors.badgeCheckedBg,
      }}
    >
      <AppText variant="caption" style={{ fontWeight: '600', color: colors.badgeCheckedFg }}>
        {t('capture.quality')}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityElementsHidden>
        {[1, 2, 3].map((bar) => (
          <View
            key={bar}
            style={{
              width: BAR_WIDTH,
              height: BAR_HEIGHT,
              borderRadius: 1,
              backgroundColor: colors.badgeCheckedFg,
              opacity: bar <= BARS[band] ? 1 : 0.3,
            }}
          />
        ))}
      </View>
      <AppText variant="caption" style={{ fontWeight: '600', color: colors.badgeCheckedFg }}>
        {word}
      </AppText>
    </View>
  );
}

import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { labelAt } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

const BAR_WIDTH = 4;
const BAR_HEIGHT = 11;
const BARS = { weak: 1, ok: 2, strong: 3 } as const;

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
  const band = labelAt(level);
  if (band === null && !checking) return null;
  const word =
    band === null
      ? t('capture.qualityChecking')
      : { weak: t('signal.weak'), ok: t('signal.ok'), strong: t('capture.qualityGood') }[band];
  return (
    <View
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
          <View
            key={barNumber}
            style={{
              width: BAR_WIDTH,
              height: BAR_HEIGHT,
              borderRadius: 1,
              backgroundColor: colors.badgeCheckedFg,
              opacity: band !== null && barNumber <= BARS[band] ? 1 : 0.3,
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

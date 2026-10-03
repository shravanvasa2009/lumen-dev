import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { ratingModeLabel, tierLabel } from '@/rating/labels';
import { useRatingReveal } from '@/rating/useRatingReveal';
import { RatingGauge } from '@/settings/RatingGauge';
import type { StoredRating } from '@/store/deviceRating';
import { useTheme } from '@/theme';

function UnlockedModes({ rating }: { rating: StoredRating }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {t('rating.unlocked')}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {rating.unlocks.map((mode) => (
          <View
            key={mode}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.accent,
              backgroundColor: colors.surface2,
            }}
          >
            <Icon name="check" size={16} color={colors.accent} />
            <AppText variant="caption" tone="accent">
              {ratingModeLabel(t, mode)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

// One sentence for the reason a tier is what it is, when the tier is below what the hardware could do.
function ratingNote(rating: StoredRating, t: TFunction): string | null {
  if (rating.hardFail === 'no-rear-camera') return t('rating.failNoCamera');
  if (rating.hardFail === 'below-24-fps') return t('rating.failFps');
  if (rating.hardFail === 'no-pulse') return t('rating.failNoPulse');
  if (rating.ambient) return t('rating.ambient');
  return rating.tier === 'unsupported' ? t('rating.failScore') : null;
}

export default function RatingScreen() {
  const { t } = useTranslation();
  const reveal = useRatingReveal();
  const rating = reveal.kind === 'rated' ? reveal.rating : null;
  const note = rating === null ? null : ratingNote(rating, t);
  return (
    <OnboardingStep
      step={7}
      title={t('rating.title')}
      subtitle={t('rating.subtitle')}
      footer={<NavButton label={t('common.continue')} href="/reminders" />}
    >
      {rating === null ? (
        <>
          <RatingGauge
            score={null}
            label={t('phoneRating.noScore')}
            caption={reveal.kind === 'measuring' ? t('rating.measuring') : t('phoneRating.notTested')}
          />
          {reveal.kind === 'unrated' ? (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('rating.pending')}
            </AppText>
          ) : null}
        </>
      ) : (
        <>
          <RatingGauge
            score={rating.score}
            label={String(rating.score)}
            caption={tierLabel(t, rating.tier)}
          />
          {note === null ? null : (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {note}
            </AppText>
          )}
          {rating.tier === 'unsupported' ? (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('rating.demoOffer')}
            </AppText>
          ) : (
            <UnlockedModes rating={rating} />
          )}
        </>
      )}
    </OnboardingStep>
  );
}

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import {
  CHECK_ICON,
  CHECK_IDS,
  CHECK_PILL,
  type CheckId,
  checkCell,
  type PlanMode,
  planPhone,
} from '@/checks/checkPlan';
import { lockText } from '@/checks/lockText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { TryDemoButton } from '@/demo/TryDemoButton';
import { ratingModeLabel, tierLabel } from '@/rating/labels';
import { useRatingReveal } from '@/rating/useRatingReveal';
import { RatingGauge } from '@/settings/RatingGauge';
import { SectionLabel } from '@/settings/SectionLabel';
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

// Each check is listed under the mode that runs it: the Standing test for POTS, a Full Scan for the rest.
const LISTED_MODE: Record<CheckId, PlanMode> = {
  afib: 'full',
  hrv: 'full',
  diabetes: 'full',
  pots: 'standing',
};

function CheckableList({ rating }: { rating: StoredRating }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const names: Record<CheckId, string> = {
    afib: t('checks.afib.name'),
    hrv: t('checks.hrv.name'),
    diabetes: t('checks.diabetes.name'),
    pots: t('checks.pots.name'),
  };
  const whats: Record<CheckId, string> = {
    afib: t('checks.afib.what'),
    hrv: t('checks.hrv.what'),
    diabetes: t('checks.diabetes.what'),
    pots: t('checks.pots.whatShort'),
  };
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: radius.card,
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: spacing.md }}>
        <SectionLabel>{t('rating.checksHere')}</SectionLabel>
      </View>
      {CHECK_IDS.map((check) => {
        const cell = checkCell(LISTED_MODE[check], check, planPhone(rating));
        const lockedWhy = cell.state === 'locked' ? cell.why : null;
        const pill = CHECK_PILL[check];
        return (
          <View
            key={check}
            accessible
            accessibilityLabel={`${names[check]}: ${lockedWhy === null ? whats[check] : lockText(t, lockedWhy)}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: spacing.md,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.card - 6,
                backgroundColor: colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon
                name={CHECK_ICON[check]}
                size={20}
                color={lockedWhy === null ? colors.accent : colors.textFaint}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <AppText variant="headline" tone={lockedWhy === null ? 'text' : 'textDim'}>
                  {names[check]}
                </AppText>
                {pill === null ? null : <EvidenceBadge metric={pill} />}
              </View>
              <AppText variant="caption" tone="textDim">
                {lockedWhy === null ? whats[check] : lockText(t, lockedWhy)}
              </AppText>
            </View>
            <Icon
              name={lockedWhy === null ? 'check' : 'lock'}
              size={20}
              color={lockedWhy === null ? colors.accent : colors.textFaint}
            />
          </View>
        );
      })}
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
            <>
              <AppText tone="textDim" style={{ textAlign: 'center' }}>
                {t('rating.pending')}
              </AppText>
              <NavButton label={t('rating.practiceAgain')} href="/practice" variant="secondary" />
            </>
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
            <>
              <AppText tone="textDim" style={{ textAlign: 'center' }}>
                {t('rating.demoOffer')}
              </AppText>
              <TryDemoButton />
            </>
          ) : (
            <>
              <UnlockedModes rating={rating} />
              <CheckableList rating={rating} />
            </>
          )}
        </>
      )}
    </OnboardingStep>
  );
}

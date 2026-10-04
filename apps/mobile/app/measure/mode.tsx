import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { lockText } from '@/checks/lockText';
import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';
import { durationLabel } from '@/measure/durationLabel';
import { MODES } from '@/measure/mode';
import { ModeCard } from '@/measure/ModeCard';
import { tierLabel } from '@/rating/labels';
import { lockReason } from '@/rating/modeLock';
import { useStoredRating } from '@/store/useStoredRating';

export default function ModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rating = useStoredRating();
  // The rating's reason (spec §5.3) when this phone's tier leaves the mode locked; otherwise nothing.
  const lock = (mode: keyof typeof MODES) => {
    const reason = lockReason(rating, mode);
    if (reason === null) return {};
    return { unavailable: lockText(t, reason), locked: true };
  };
  return (
    <RouteShell title={t('mode.title')}>
      <ModeCard
        title={t('mode.full')}
        body={t('mode.fullBody')}
        duration={durationLabel(t, MODES.full.duration)}
        recommended={t('mode.recommended')}
        onPress={() => router.push('/measure/precheck?mode=full')}
        {...lock('full')}
      />
      <ModeCard
        title={t('mode.quick')}
        body={t('mode.quickBody')}
        duration={durationLabel(t, MODES.quick.duration)}
        onPress={() => router.push('/measure/precheck?mode=quick')}
        {...lock('quick')}
      />
      <ModeCard
        title={t('mode.deep')}
        body={t('mode.deepBody')}
        duration={durationLabel(t, MODES.deep.duration)}
        unavailable={t('mode.deepSoon')}
        {...lock('deep')}
      />
      <ModeCard
        title={t('mode.standing')}
        body={t('mode.standingBody')}
        duration={durationLabel(t, MODES.standing.duration)}
        onPress={() => router.push('/measure/standing-test')}
        {...lock('standing')}
      />
      {rating ? (
        <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
          {t('mode.ratingFooter', { tier: tierLabel(t, rating.tier), score: rating.score })}
        </AppText>
      ) : null}
    </RouteShell>
  );
}

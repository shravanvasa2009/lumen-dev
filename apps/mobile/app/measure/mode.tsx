import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { durationLabel } from '@/measure/durationLabel';
import { MODES } from '@/measure/mode';
import { ModeCard } from '@/measure/ModeCard';

export default function ModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <RouteShell title={t('mode.title')}>
      <ModeCard
        title={t('mode.full')}
        body={t('mode.fullBody')}
        duration={durationLabel(t, MODES.full.duration)}
        recommended={t('mode.recommended')}
        onPress={() => router.push('/measure/precheck?mode=full')}
      />
      <ModeCard
        title={t('mode.quick')}
        body={t('mode.quickBody')}
        duration={durationLabel(t, MODES.quick.duration)}
        onPress={() => router.push('/measure/precheck?mode=quick')}
      />
      <ModeCard
        title={t('mode.deep')}
        body={t('mode.deepBody')}
        duration={durationLabel(t, MODES.deep.duration)}
        unavailable={t('mode.deepSoon')}
      />
      <ModeCard
        title={t('mode.standing')}
        body={t('mode.standingBody')}
        duration={durationLabel(t, MODES.standing.duration)}
        onPress={() => router.push('/measure/standing-test')}
      />
    </RouteShell>
  );
}

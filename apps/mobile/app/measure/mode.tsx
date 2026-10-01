import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
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
        duration={t('mode.seconds', { count: MODES.full.cleanSeconds })}
        recommended={t('mode.recommended')}
        onPress={() => router.push('/measure/precheck?mode=full')}
      />
      <ModeCard
        title={t('mode.quick')}
        body={t('mode.quickBody')}
        duration={t('mode.seconds', { count: MODES.quick.cleanSeconds })}
        onPress={() => router.push('/measure/precheck?mode=quick')}
      />
      <ModeCard
        title={t('mode.deep')}
        body={t('mode.deepBody')}
        duration={t('mode.minutes', { count: 5 })}
        unavailable={t('mode.deepSoon')}
      />
      <ModeCard
        title={t('mode.standing')}
        body={t('mode.standingBody')}
        duration={t('mode.approxMinutes', { count: 12 })}
        onPress={() => router.push('/measure/standing-test')}
      />
    </RouteShell>
  );
}

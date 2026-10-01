import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function PhoneCheckScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('phoneCheck.title')}
      subtitle={t('phoneCheck.subtitle')}
      sections={[
        {
          heading: t('phoneCheck.capabilities'),
          lines: [
            t('phoneCheck.cameraSpeed'),
            t('phoneCheck.flashlight'),
            t('phoneCheck.exposureLock'),
            t('phoneCheck.frameTiming'),
            t('phoneCheck.lenses'),
            t('phoneCheck.nextStep'),
          ],
        },
      ]}
    >
      <NavButton label={t('phoneCheck.next')} href="/placement" />
    </RouteShell>
  );
}

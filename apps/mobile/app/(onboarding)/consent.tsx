import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function ConsentScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('consent.title')}
      subtitle={t('consent.core')}
      sections={[
        {
          heading: t('consent.can'),
          lines: [t('consent.canPulse'), t('consent.canRhythm'), t('consent.canHrv')],
        },
        {
          heading: t('consent.cannot'),
          lines: [t('consent.cannotDiagnose'), t('consent.cannotReplace'), t('consent.cannotDetect')],
        },
        { heading: t('consent.callWarning') },
        { heading: t('consent.understand') },
      ]}
    >
      <NavButton label={t('common.continue')} href="/profile" />
    </RouteShell>
  );
}

import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function WidgetsScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('widgets.title')}
      sections={[
        {
          heading: t('widgets.iphoneHome'),
          lines: [t('widgets.howToAdd'), t('widgets.buttons')],
        },
        { heading: t('widgets.iphoneLock') },
        { heading: t('widgets.android'), lines: [t('widgets.androidBody')] },
      ]}
    >
      <NavButton
        label={t('widgets.lockScreenLink')}
        href="/settings/widgets/lock-screen"
        variant="secondary"
      />
    </RouteShell>
  );
}

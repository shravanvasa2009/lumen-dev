import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';

export default function LockScreenPreviewScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('lockScreen.title')}
      sections={[
        {
          heading: t('lockScreen.timer'),
          lines: [t('lockScreen.nextReading'), t('lockScreen.tap')],
        },
        { heading: t('lockScreen.reminder') },
      ]}
    />
  );
}

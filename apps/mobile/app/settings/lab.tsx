import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';

export default function LabScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('lab.title')}
      subtitle={t('lab.badge')}
      sections={[{ heading: t('lab.rawRgb') }, { heading: t('lab.sqi') }, { heading: t('lab.reference') }]}
    />
  );
}

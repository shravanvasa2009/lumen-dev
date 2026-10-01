import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';

export default function TrendsScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      tabRoot
      title={t('trends.title')}
      sections={[
        { heading: t('trends.restingHr') },
        { heading: t('trends.hrv') },
        { heading: t('trends.breathing') },
        { heading: t('trends.median') },
        { heading: t('trends.band') },
        { heading: t('trends.readings') },
      ]}
    />
  );
}

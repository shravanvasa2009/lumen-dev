import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { demoHistory, demoNow } from '@/trends/demoHistory';
import { TrendsView } from '@/trends/TrendsView';

// No reading store exists yet, so the tab shows the sample history under the Demo banner.
export default function TrendsScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell tabRoot title={t('trends.title')}>
      <TrendsView readings={demoHistory} now={demoNow} demo />
    </RouteShell>
  );
}

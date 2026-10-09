import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { useDemoActive } from '@/demo/demoSession';
import { useStoredReadings } from '@/store/useStoredReadings';
import { demoHistory, demoNow } from '@/trends/demoHistory';
import { historyFromStored } from '@/trends/storedHistory';
import { TrendsView } from '@/trends/TrendsView';

// A demo session shows the sample history under the Demo banner (§8.5); otherwise only readings saved on
// this phone appear, and with none the screen says so.
export default function TrendsScreen() {
  const { t } = useTranslation();
  const demo = useDemoActive();
  const stored = useStoredReadings();
  const saved = useMemo(() => historyFromStored(stored), [stored]);
  return (
    <RouteShell tabRoot title={t('trends.title')}>
      <TrendsView readings={demo ? demoHistory : saved} now={demo ? demoNow : new Date()} demo={demo} />
    </RouteShell>
  );
}

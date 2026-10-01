import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function WhyScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('why.title')}
      sections={[
        { heading: t('why.intervals') },
        { heading: t('why.poincare'), lines: [t('why.yours'), t('why.typical')] },
        { heading: t('why.extraBeats') },
      ]}
    >
      <NavButton label={t('results.accuracy')} href="/settings/accuracy" variant="secondary" />
    </RouteShell>
  );
}

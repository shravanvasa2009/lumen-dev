import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function PlacementScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      headerless
      title={t('placement.title')}
      subtitle={t('placement.flashOutsideBump')}
      sections={[
        { heading: t('placement.lens') },
        { heading: t('placement.flash') },
        { heading: t('placement.tipCover'), lines: [t('placement.tipCase'), t('placement.tipWipe')] },
      ]}
    >
      <NavButton label={t('placement.start')} href="/practice" />
    </RouteShell>
  );
}

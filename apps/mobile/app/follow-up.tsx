import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function FollowUpScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('followUp.title')}
      subtitle={t('followUp.subtitle')}
      sections={[{ heading: t('followUp.whatToAsk'), lines: [t('followUp.whatToAskBody')] }]}
    >
      <NavButton label={t('followUp.saw')} href="/" replace />
      <NavButton label={t('followUp.booked')} href="/" variant="secondary" replace />
      <NavButton label={t('followUp.notYet')} href="/" variant="secondary" replace />
    </RouteShell>
  );
}

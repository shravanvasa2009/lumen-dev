import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';

export default function AppearanceScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('appearance.title')}
      sections={[
        {
          heading: t('appearance.system'),
          lines: [t('appearance.light'), t('appearance.dark')],
        },
        { heading: t('appearance.following'), lines: [t('appearance.followingBody')] },
      ]}
    >
      <AppText variant="caption" tone="textDim">
        {t('appearance.note')}
      </AppText>
    </RouteShell>
  );
}

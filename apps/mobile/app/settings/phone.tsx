import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function PhoneRatingScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('phoneRating.title')}
      sections={[
        { heading: t('phoneRating.frameRate') },
        { heading: t('phoneRating.coupling') },
        { heading: t('phoneRating.lock') },
        { heading: t('phoneRating.timing') },
      ]}
    >
      <NavButton label={t('phoneRating.retest')} href="/phone-check" />
      <AppText variant="caption" tone="textDim">
        {t('phoneRating.tip')}
      </AppText>
    </RouteShell>
  );
}

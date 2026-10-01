import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { RatingGauge } from '@/onboarding/RatingGauge';

export default function RatingScreen() {
  const { t } = useTranslation();
  return (
    <OnboardingStep
      step={7}
      title={t('rating.title')}
      subtitle={t('rating.subtitle')}
      centered
      footer={<NavButton label={t('common.continue')} href="/reminders" />}
    >
      {/* The score needs the coupling measured in practice (spec §5.1), and no rating function exists yet. */}
      <RatingGauge score={null} />
      <AppText tone="textDim" style={{ textAlign: 'center' }}>
        {t('rating.pending')}
      </AppText>
    </OnboardingStep>
  );
}

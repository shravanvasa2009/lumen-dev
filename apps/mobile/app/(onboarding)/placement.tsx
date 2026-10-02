import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { PhoneBackIllustration } from '@/components/PhoneBackIllustration';
import { useTheme } from '@/theme';

export default function PlacementScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const tips = [t('placement.tipCover'), t('placement.tipCase'), t('placement.tipWipe')];
  return (
    <OnboardingStep
      step={4}
      title={t('placement.title')}
      subtitle={t('placement.subtitle')}
      footer={<NavButton label={t('placement.start')} href="/practice" />}
    >
      <PhoneBackIllustration lensLabel={t('placement.lens')} flashLabel={t('placement.flash')} />
      <Card>
        <AppText variant="headline">{t('placement.flashOutsideBump')}</AppText>
        {tips.map((tip) => (
          <View key={tip} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <AppText tone="textDim">•</AppText>
            <AppText tone="textDim">{tip}</AppText>
          </View>
        ))}
      </Card>
    </OnboardingStep>
  );
}

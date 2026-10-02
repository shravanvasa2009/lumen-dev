import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { SeatedIllustration } from '@/onboarding/SeatedIllustration';
import { useTheme } from '@/theme';

export default function HowToSitScreen() {
  const { t } = useTranslation();
  const { colors, control } = useTheme();
  const checklist = [t('howToSit.elbows'), t('howToSit.height'), t('howToSit.hand'), t('howToSit.warm')];
  return (
    <OnboardingStep
      step={6}
      title={t('howToSit.title')}
      subtitle={t('howToSit.subtitle')}
      footer={<NavButton label={t('common.continue')} href="/rating" />}
    >
      <Card>
        <SeatedIllustration phoneLabel={t('howToSit.labelPhone')} elbowLabel={t('howToSit.labelElbow')} />
      </Card>
      <Card flush>
        {checklist.map((item, index) => (
          <ListRow
            key={item}
            title={item}
            last={index === checklist.length - 1}
            leading={
              <View style={{ width: control.chevronSize }}>
                <Icon name="check" size={control.chevronSize} color={colors.accent} />
              </View>
            }
          />
        ))}
      </Card>
    </OnboardingStep>
  );
}

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { PhoneBackIllustration } from '@/components/PhoneBackIllustration';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

const CHIP_SIZE = 40;

export default function PlacementScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const tips: { icon: IconName; label: string }[] = [
    { icon: 'hint', label: t('placement.tipCover') },
    { icon: 'phone', label: t('placement.tipCase') },
    { icon: 'lens', label: t('placement.tipWipe') },
  ];
  return (
    <OnboardingStep
      step={4}
      title={t('placement.title')}
      subtitle={t('placement.subtitle')}
      footer={<NavButton label={t('placement.start')} href="/practice" />}
    >
      <PhoneBackIllustration lensLabel={t('placement.lens')} flashLabel={t('placement.flash')} />
      <View
        testID="placement-instruction"
        style={{
          backgroundColor: colors.badgeCheckedBg,
          borderRadius: radius.card,
          padding: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        <Icon name="finger" size={control.chevronSize} color={colors.accent} />
        <AppText variant="headline" style={{ flex: 1 }}>
          {t('placement.flashOutsideBump')}
        </AppText>
      </View>
      <SectionLabel>{t('placement.tipsHeading')}</SectionLabel>
      <Card>
        {tips.map(({ icon, label }) => (
          <View
            key={label}
            testID="placement-tip"
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <View
              style={{
                width: CHIP_SIZE,
                height: CHIP_SIZE,
                borderRadius: radius.card,
                backgroundColor: colors.badgeCheckedBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={icon} size={control.chevronSize} color={colors.accent} />
            </View>
            <AppText style={{ flex: 1 }}>{label}</AppText>
          </View>
        ))}
      </Card>
    </OnboardingStep>
  );
}

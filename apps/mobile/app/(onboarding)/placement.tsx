import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingFrame } from '@/onboarding/OnboardingFrame';
import { placementCopy, usePhoneBackLayout } from '@/onboarding/phoneBackLayouts';
import { PlacementFigure } from '@/onboarding/PlacementFigure';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

export default function PlacementScreen() {
  const { t } = useTranslation();
  const phoneBackLayout = usePhoneBackLayout();
  const { colors, spacing, radius, control } = useTheme();
  const tips: { icon: IconName; label: string }[] = [
    { icon: 'hint', label: t('placement.tipCover') },
    { icon: 'phone', label: t('placement.tipCase') },
    { icon: 'lens', label: t('placement.tipWipe') },
    { icon: 'elbow', label: t('placement.tipPosture') },
  ];
  return (
    <OnboardingFrame
      step={3}
      title={t('placement.title')}
      subtitle={t('placement.subtitle')}
      footer={<NavButton label={t('placement.start')} href="/practice" />}
    >
      <PlacementFigure />
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
          {placementCopy(t, phoneBackLayout.model).instruction}
        </AppText>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionLabel>{t('placement.tipsHeading')}</SectionLabel>
        <Card flush>
          {tips.map(({ icon, label }, index) => (
            <ListRow
              key={label}
              title={label}
              last={index === tips.length - 1}
              leading={<Icon name={icon} size={control.chevronSize} color={colors.accent} />}
            />
          ))}
        </Card>
        <AppText variant="caption" tone="textDim">
          {t('placement.tipWarm')}
        </AppText>
      </View>
    </OnboardingFrame>
  );
}

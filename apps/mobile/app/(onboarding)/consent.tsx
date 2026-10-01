import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { IconLine } from '@/components/IconLine';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { useTheme } from '@/theme';

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [understood, setUnderstood] = useState(false);
  return (
    <OnboardingStep
      step={1}
      title={t('consent.title')}
      footer={<NavButton label={t('common.continue')} href="/profile" disabled={!understood} />}
    >
      <Card>
        <AppText variant="headline">{t('consent.can')}</AppText>
        <IconLine icon="check">{t('consent.canPulse')}</IconLine>
        <IconLine icon="check">{t('consent.canRhythm')}</IconLine>
        <IconLine icon="check">{t('consent.canHrv')}</IconLine>
      </Card>
      <Card>
        <AppText variant="headline">{t('consent.cannot')}</AppText>
        <IconLine icon="close" tone="textDim">
          {t('consent.cannotDiagnose')}
        </IconLine>
        <IconLine icon="close" tone="textDim">
          {t('consent.cannotReplace')}
        </IconLine>
        <IconLine icon="close" tone="textDim">
          {t('consent.cannotDetect')}
        </IconLine>
      </Card>
      <View
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.card,
          backgroundColor: colors.flagBg,
        }}
      >
        <Icon name="warning" size={control.chevronSize} color={colors.flag} />
        <AppText variant="headline" style={{ flex: 1, color: colors.flag }}>
          {t('consent.callWarning')}
        </AppText>
      </View>
      <Checkbox label={t('consent.understand')} checked={understood} onChange={setUnderstood} />
    </OnboardingStep>
  );
}

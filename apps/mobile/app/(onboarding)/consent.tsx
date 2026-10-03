import { type ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

type IconName = ComponentProps<typeof Icon>['name'];

const TILE_SIZE = 36;

function ConsentRow({ icon, allowed, children }: { icon: IconName; allowed: boolean; children: string }) {
  const { colors, spacing, radius, control } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View
        style={{
          width: TILE_SIZE,
          height: TILE_SIZE,
          borderRadius: radius.card / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: allowed ? colors.badgeCheckedBg : colors.surface3,
        }}
      >
        <Icon name={icon} size={control.chevronSize} color={allowed ? colors.accent : colors.textDim} />
      </View>
      <AppText style={{ flex: 1 }}>{children}</AppText>
    </View>
  );
}

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [understood, setUnderstood] = useState(false);
  return (
    <OnboardingStep
      step={1}
      title={t('consent.title')}
      footer={
        <View testID="consent-footer" style={{ gap: spacing.md }}>
          <Checkbox label={t('consent.understand')} checked={understood} onChange={setUnderstood} />
          <NavButton label={t('common.continue')} href="/profile" disabled={!understood} />
        </View>
      }
    >
      <View style={{ gap: spacing.sm }}>
        <SectionLabel>{t('consent.can')}</SectionLabel>
        <Card>
          <ConsentRow icon="finger" allowed>
            {t('consent.canPulse')}
          </ConsentRow>
          <ConsentRow icon="care" allowed>
            {t('consent.canRhythm')}
          </ConsentRow>
          <ConsentRow icon="trends" allowed>
            {t('consent.canHrv')}
          </ConsentRow>
        </Card>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionLabel>{t('consent.cannot')}</SectionLabel>
        <Card>
          <ConsentRow icon="close" allowed={false}>
            {t('consent.cannotDiagnose')}
          </ConsentRow>
          <ConsentRow icon="care" allowed={false}>
            {t('consent.cannotReplace')}
          </ConsentRow>
          <ConsentRow icon="warning" allowed={false}>
            {t('consent.cannotDetect')}
          </ConsentRow>
        </Card>
      </View>
      <View
        accessible
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
    </OnboardingStep>
  );
}

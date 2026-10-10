import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingFrame } from '@/onboarding/OnboardingFrame';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

function ConsentGroup({ heading, allowed, texts }: { heading: string; allowed: boolean; texts: string[] }) {
  const { colors, spacing, control } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel>{heading}</SectionLabel>
      <Card flush>
        {texts.map((text, index) => (
          <ListRow
            key={text}
            title={text}
            last={index === texts.length - 1}
            leading={
              <Icon
                name={allowed ? 'check' : 'close'}
                size={control.chevronSize}
                color={allowed ? colors.accent : colors.textDim}
              />
            }
          />
        ))}
      </Card>
    </View>
  );
}

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [understood, setUnderstood] = useState(false);
  return (
    <OnboardingFrame
      step={1}
      title={t('consent.title')}
      footer={
        <View testID="consent-footer" style={{ gap: spacing.md }}>
          <Card>
            <Checkbox label={t('consent.understand')} checked={understood} onChange={setUnderstood} />
          </Card>
          <NavButton label={t('common.continue')} href="/profile" disabled={!understood} />
        </View>
      }
    >
      <ConsentGroup
        heading={t('consent.can')}
        allowed
        texts={[t('consent.canPulse'), t('consent.canRhythm'), t('consent.canHrv')]}
      />
      <ConsentGroup
        heading={t('consent.cannot')}
        allowed={false}
        texts={[t('consent.cannotDiagnose'), t('consent.cannotReplace'), t('consent.cannotDetect')]}
      />
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
    </OnboardingFrame>
  );
}

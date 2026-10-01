import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { SectionLabel } from '@/components/SectionLabel';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SwitchRow } from '@/components/SwitchRow';
import { useTheme } from '@/theme';

// Spec §8.2 step 3: the tutorial passes once an age of 13 or more is entered.
const MIN_AGE = 13;

type Sex = 'female' | 'male' | 'preferNot';
type HealthNote = 'betaBlocker' | 'pacemaker' | 'afibReported' | 'athlete';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [ageText, setAgeText] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [notes, setNotes] = useState<Record<HealthNote, boolean>>({
    betaBlocker: false,
    pacemaker: false,
    afibReported: false,
    athlete: false,
  });
  const ageEntered = ageText !== '';
  const ageValid = ageEntered && Number(ageText) >= MIN_AGE;
  const noteRows: readonly { note: HealthNote; title: string }[] = [
    { note: 'betaBlocker', title: t('profile.betaBlocker') },
    { note: 'pacemaker', title: t('profile.pacemaker') },
    { note: 'afibReported', title: t('profile.afibReported') },
    { note: 'athlete', title: t('profile.athlete') },
  ];
  return (
    <OnboardingStep
      step={2}
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      footer={<NavButton label={t('common.continue')} href="/phone-check" disabled={!ageValid} />}
    >
      <View style={{ gap: spacing.sm }}>
        <SectionLabel>{t('profile.basics')}</SectionLabel>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: control.primaryButtonHeight,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface2,
          }}
        >
          <AppText tone="textDim">{t('profile.age')}</AppText>
          <AppText variant="caption" tone="textFaint">
            {t('profile.ageMin')}
          </AppText>
          <TextInput
            accessibilityLabel={t('profile.age')}
            placeholder={t('profile.agePlaceholder')}
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            maxLength={3}
            value={ageText}
            onChangeText={(text) => setAgeText(text.replace(/\D/g, ''))}
            style={{ flex: 1, textAlign: 'right', fontSize: 16, color: colors.text }}
          />
        </View>
        {ageEntered && !ageValid ? (
          <AppText variant="caption" tone="textDim">
            {t('profile.ageTooYoung')}
          </AppText>
        ) : null}
        <SegmentedControl
          label={t('profile.sex')}
          value={sex}
          onChange={setSex}
          options={[
            { value: 'female', label: t('profile.female') },
            { value: 'male', label: t('profile.male') },
            { value: 'preferNot', label: t('profile.preferNot') },
          ]}
        />
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionLabel>{t('profile.healthNotes')}</SectionLabel>
        <Card flush>
          {noteRows.map(({ note, title }, index) => (
            <SwitchRow
              key={note}
              title={title}
              value={notes[note]}
              last={index === noteRows.length - 1}
              onChange={(value) => setNotes({ ...notes, [note]: value })}
            />
          ))}
        </Card>
        <AppText variant="caption" tone="textDim">
          {t('profile.note')}
        </AppText>
      </View>
    </OnboardingStep>
  );
}

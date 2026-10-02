import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { isValidPhone, useDoctorPhone } from '@/profile/doctorPhone';
import { SectionLabel } from '@/settings/SectionLabel';
import { Segmented } from '@/settings/Segmented';
import { type HealthNote, loadProfile, saveHealthNote } from '@/store/profile';
import { Toggle } from '@/settings/Toggle';
import { useTheme } from '@/theme';

// Spec §8.2 step 3: the tutorial passes once an age of 13 or more is entered.
const MIN_AGE = 13;

type Sex = 'female' | 'male' | 'preferNot';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [ageText, setAgeText] = useState('');
  const { phone, setPhone } = useDoctorPhone();
  const [phoneText, setPhoneText] = useState(phone ?? '');
  const [sex, setSex] = useState<Sex | null>(null);
  const [notes, setNotes] = useState<Record<HealthNote, boolean>>({
    betaBlocker: false,
    pacemaker: false,
    knownAf: false,
    athlete: false,
  });
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadProfile().then(
      (saved) => {
        if (active) setNotes(saved);
      },
      () => {
        if (active) setSaveFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const ageEntered = ageText !== '';
  const ageValid = ageEntered && Number(ageText) >= MIN_AGE;
  const phoneInvalid = phoneText.trim() !== '' && !isValidPhone(phoneText.trim());
  const noteRows: readonly { note: HealthNote; title: string }[] = [
    { note: 'betaBlocker', title: t('profile.betaBlocker') },
    { note: 'pacemaker', title: t('profile.pacemaker') },
    { note: 'knownAf', title: t('profile.afibReported') },
    { note: 'athlete', title: t('profile.athlete') },
  ];
  // Only a valid number is saved; an empty or invalid field leaves the doctor's phone unset.
  function updateDoctorPhone(text: string) {
    setPhoneText(text);
    const trimmed = text.trim();
    setPhone(isValidPhone(trimmed) ? trimmed : null);
  }
  // The analysis reads these answers (a pacemaker turns rhythm screening off), so a failed save is shown.
  function saveNote(note: HealthNote, value: boolean) {
    setNotes({ ...notes, [note]: value });
    setSaveFailed(false);
    saveHealthNote(note, value).catch(() => setSaveFailed(true));
  }
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
          <AppText variant="caption" tone="textDim" accessibilityRole="alert">
            {t('profile.ageTooYoung')}
          </AppText>
        ) : null}
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
          <AppText tone="textDim" style={{ flexShrink: 1 }}>
            {t('profile.doctorPhone')}
          </AppText>
          <TextInput
            accessibilityLabel={t('profile.doctorPhone')}
            placeholder={t('profile.doctorPhonePlaceholder')}
            placeholderTextColor={colors.textFaint}
            keyboardType="phone-pad"
            maxLength={24}
            value={phoneText}
            onChangeText={updateDoctorPhone}
            style={{ flex: 1, textAlign: 'right', fontSize: 16, color: colors.text }}
          />
        </View>
        {phoneInvalid ? (
          <AppText variant="caption" tone="textDim" accessibilityRole="alert">
            {t('profile.doctorPhoneInvalid')}
          </AppText>
        ) : null}
        <Segmented
          label={t('profile.sex')}
          selected={sex}
          onSelect={setSex}
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
            <ListRow
              key={note}
              title={title}
              last={index === noteRows.length - 1}
              trailing={
                <Toggle label={title} value={notes[note]} onValueChange={(value) => saveNote(note, value)} />
              }
            />
          ))}
        </Card>
        <AppText variant="caption" tone="textDim">
          {t('profile.note')}
        </AppText>
        {saveFailed ? (
          <AppText variant="caption" tone="textDim" accessibilityRole="alert">
            {t('profile.saveFailed')}
          </AppText>
        ) : null}
      </View>
    </OnboardingStep>
  );
}

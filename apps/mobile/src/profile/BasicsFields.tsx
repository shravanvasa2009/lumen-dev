import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { formatNumber } from '@/i18n/formatNumber';
import { Segmented } from '@/settings/Segmented';
import { useTheme } from '@/theme';

import {
  assessRisk,
  bmiOf,
  bmiShown,
  cmFromInches,
  HEIGHT_CM,
  inchesFromCm,
  kgFromPounds,
  MIN_APP_AGE,
  poundsFromKg,
  type RiskDraft,
  type Sex,
  WEIGHT_KG,
} from './diabetesRisk';

type Units = 'metric' | 'imperial';

type BasicsFieldsProps = {
  draft: RiskDraft;
  change: <Field extends keyof RiskDraft>(field: Field, value: RiskDraft[Field]) => void;
};

const roundToTenth = (value: number) => Math.round(value * 10) / 10;

function numberText(value: number | null, language: string): string {
  return value === null ? '' : formatNumber(value, language);
}

// A lone "." has no value yet. A Spanish keyboard types a comma for the decimal mark, so either one counts.
function parseTyped(text: string): number | null {
  const parsed = Number(text.replace(',', '.'));
  return text === '' || Number.isNaN(parsed) ? null : parsed;
}

// Digits and at most one decimal mark, a point or a comma.
const cleanTyped = (text: string) => text.replace(/[^0-9.,]/g, '').replace(/([.,].*)[.,]/, '$1');

type FieldRowProps = {
  label: string;
  suffix: string;
  text: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  hint?: string;
  placeholder?: string;
  wholeNumber?: boolean;
};

function FieldRow({
  label,
  suffix,
  text,
  onChangeText,
  maxLength,
  hint,
  placeholder,
  wholeNumber,
}: FieldRowProps) {
  const { colors, spacing, radius, control } = useTheme();
  return (
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
      <AppText tone="textDim">{label}</AppText>
      {hint ? (
        <AppText variant="caption" tone="textFaint">
          {hint}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={wholeNumber ? 'number-pad' : 'decimal-pad'}
        maxLength={maxLength}
        value={text}
        onChangeText={onChangeText}
        style={{ flex: 1, textAlign: 'right', fontSize: 16, color: colors.text }}
      />
      <AppText tone="textDim">{suffix}</AppText>
    </View>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <AppText variant="caption" tone="textDim" accessibilityRole="alert">
      {message}
    </AppText>
  );
}

// Age, sex, height and weight with a live body mass index. Typed text stays here in the unit shown;
// the draft always holds metric, and the body mass index is worked out for display and never stored.
export function BasicsFields({ draft, change }: BasicsFieldsProps) {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const [units, setUnits] = useState<Units>('metric');
  const [ageText, setAgeText] = useState(numberText(draft.ageYears, i18n.language));
  const [heightText, setHeightText] = useState(numberText(draft.heightCm, i18n.language));
  const [weightText, setWeightText] = useState(numberText(draft.weightKg, i18n.language));
  const imperial = units === 'imperial';
  const heightUnit = imperial ? 'in' : 'cm';
  const weightUnit = imperial ? 'lb' : 'kg';
  const assessment = assessRisk(draft);
  const invalid = assessment.status === 'invalid' ? assessment.fields : [];
  const { ageYears, heightCm, weightKg } = draft;

  function showUnits(next: Units) {
    setUnits(next);
    const toImperial = next === 'imperial';
    setHeightText(
      numberText(heightCm === null ? null : toImperial ? inchesFromCm(heightCm) : heightCm, i18n.language),
    );
    setWeightText(
      numberText(weightKg === null ? null : toImperial ? poundsFromKg(weightKg) : weightKg, i18n.language),
    );
  }

  function typeAge(text: string) {
    const digits = text.replace(/\D/g, '');
    setAgeText(digits);
    change('ageYears', parseTyped(digits));
  }

  function typeHeight(text: string) {
    const cleaned = cleanTyped(text);
    setHeightText(cleaned);
    const typed = parseTyped(cleaned);
    change('heightCm', typed === null ? null : roundToTenth(imperial ? cmFromInches(typed) : typed));
  }

  function typeWeight(text: string) {
    const cleaned = cleanTyped(text);
    setWeightText(cleaned);
    const typed = parseTyped(cleaned);
    change('weightKg', typed === null ? null : roundToTenth(imperial ? kgFromPounds(typed) : typed));
  }

  const heightRange = imperial
    ? { min: Math.ceil(inchesFromCm(HEIGHT_CM.min)), max: Math.floor(inchesFromCm(HEIGHT_CM.max)) }
    : HEIGHT_CM;
  const weightRange = imperial
    ? { min: Math.ceil(poundsFromKg(WEIGHT_KG.min)), max: Math.floor(poundsFromKg(WEIGHT_KG.max)) }
    : WEIGHT_KG;
  const bodyUsable =
    heightCm !== null && weightKg !== null && !invalid.includes('height') && !invalid.includes('weight');
  const bmiText = bodyUsable ? bmiShown(bmiOf(heightCm, weightKg), i18n.language) : '—';

  return (
    <View style={{ gap: spacing.sm }}>
      <FieldRow
        label={t('profile.age')}
        hint={t('profile.ageMin')}
        suffix={t('profile.years')}
        placeholder={t('profile.agePlaceholder')}
        text={ageText}
        onChangeText={typeAge}
        maxLength={3}
        wholeNumber
      />
      {ageYears !== null && ageYears < MIN_APP_AGE ? <Problem message={t('profile.ageTooYoung')} /> : null}
      {invalid.includes('age') ? <Problem message={t('profile.ageInvalid')} /> : null}
      <Segmented
        label={t('profile.sex')}
        selected={draft.sex}
        onSelect={(sex: Sex) => change('sex', sex)}
        options={[
          { value: 'female', label: t('profile.female') },
          { value: 'male', label: t('profile.male') },
          { value: 'preferNot', label: t('profile.preferNot') },
        ]}
      />
      <Segmented
        label={t('profile.units')}
        selected={units}
        onSelect={showUnits}
        options={[
          { value: 'metric', label: t('profile.unitsMetric') },
          { value: 'imperial', label: t('profile.unitsImperial') },
        ]}
      />
      <FieldRow
        label={t('profile.height')}
        suffix={heightUnit}
        text={heightText}
        onChangeText={typeHeight}
        maxLength={5}
      />
      {invalid.includes('height') ? (
        <Problem message={t('profile.heightInvalid', { ...heightRange, unit: heightUnit })} />
      ) : null}
      <FieldRow
        label={t('profile.weight')}
        suffix={weightUnit}
        text={weightText}
        onChangeText={typeWeight}
        maxLength={5}
      />
      {invalid.includes('weight') ? (
        <Problem message={t('profile.weightInvalid', { ...weightRange, unit: weightUnit })} />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppText tone="textDim">{t('profile.bmi')}</AppText>
          <AppText variant="caption" tone="textFaint">
            {t('profile.bmiNote')}
          </AppText>
        </View>
        <AppText variant="headline" accessibilityLabel={`${t('profile.bmi')} ${bmiText}`}>
          {bmiText}
        </AppText>
      </View>
      {invalid.includes('bmi') ? <Problem message={t('profile.bmiInvalid')} /> : null}
    </View>
  );
}

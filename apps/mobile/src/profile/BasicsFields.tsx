import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { PressableScale } from '@/components/PressableScale';
import { formatNumber } from '@/i18n/formatNumber';
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
  return value === null ? '' : formatNumber(value, language, 1, 0, { useGrouping: false });
}

// A lone "." has no value yet. A Spanish keyboard types a comma for the decimal mark, so either one counts.
function parseTyped(text: string): number | null {
  const parsed = Number(text.replace(',', '.'));
  return text === '' || Number.isNaN(parsed) ? null : parsed;
}

// Two decimal marks ("70,5,1", "1.234,5") cannot be read as one number, so nothing is stored for them.
const hasTwoMarks = (text: string) => /[.,].*[.,]/.test(text);

const cleanTyped = (text: string) => text.replace(/[^0-9.,]/g, '');

type FieldRowProps = {
  label: string;
  suffix: string;
  text: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  placeholder?: string;
  wholeNumber?: boolean;
  last?: boolean;
};

function FieldRow({
  label,
  suffix,
  text,
  onChangeText,
  maxLength,
  placeholder,
  wholeNumber,
  last,
}: FieldRowProps) {
  const { colors, spacing } = useTheme();
  return (
    <ListRow
      title={label}
      last={last}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <TextInput
            accessibilityLabel={label}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            keyboardType={wholeNumber ? 'number-pad' : 'decimal-pad'}
            maxLength={maxLength}
            value={text}
            onChangeText={onChangeText}
            style={{ minWidth: 72, padding: 0, textAlign: 'right', fontSize: 17, color: colors.text }}
          />
          <AppText tone="textDim">{suffix}</AppText>
        </View>
      }
    />
  );
}

type PickerRowProps<Value extends string> = {
  label: string;
  shown: string;
  options: readonly { value: Value; label: string }[];
  selected: Value | null;
  onSelect: (value: Value) => void;
  last?: boolean;
};

// A row that shows the choice made and opens the options beneath it, one tap to choose.
function PickerRow<Value extends string>({
  label,
  shown,
  options,
  selected,
  onSelect,
  last,
}: PickerRowProps<Value>) {
  const { colors, spacing, control } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow
        title={label}
        last={last && !open}
        expanded={open}
        onPress={() => setOpen((was) => !was)}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <AppText tone="textDim">{shown}</AppText>
            <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
              <Icon name="chevron" size={14} color={colors.textDim} />
            </View>
          </View>
        }
      />
      {open
        ? options.map((option, index) => (
            <PressableScale
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: option.value === selected }}
              onPress={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: control.minTarget,
                paddingLeft: spacing.xxxl,
                paddingRight: spacing.lg,
                borderBottomColor: colors.line,
                borderBottomWidth: last && index === options.length - 1 ? 0 : StyleSheet.hairlineWidth,
              }}
            >
              <AppText>{option.label}</AppText>
              {option.value === selected ? <Icon name="check" size={18} color={colors.accent} /> : null}
            </PressableScale>
          ))
        : null}
    </>
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
  const [unreadable, setUnreadable] = useState({ height: false, weight: false });
  const imperial = units === 'imperial';
  const heightUnit = imperial ? 'in' : 'cm';
  const weightUnit = imperial ? 'lb' : 'kg';
  const assessment = assessRisk(draft);
  const invalid = assessment.status === 'invalid' ? assessment.fields : [];
  const { ageYears, heightCm, weightKg } = draft;

  function showUnits(next: Units) {
    setUnits(next);
    setUnreadable({ height: false, weight: false });
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

  const typeBody = (
    field: 'heightCm' | 'weightKg',
    key: 'height' | 'weight',
    setText: (text: string) => void,
    metricFrom: (typed: number) => number,
  ) =>
    function typeMeasurement(text: string) {
      const cleaned = cleanTyped(text);
      setText(cleaned);
      setUnreadable((was) => ({ ...was, [key]: hasTwoMarks(cleaned) }));
      const typed = hasTwoMarks(cleaned) ? null : parseTyped(cleaned);
      change(field, typed === null ? null : roundToTenth(metricFrom(typed)));
    };
  const typeHeight = typeBody('heightCm', 'height', setHeightText, imperial ? cmFromInches : (cm) => cm);
  const typeWeight = typeBody('weightKg', 'weight', setWeightText, imperial ? kgFromPounds : (kg) => kg);

  const heightRange = imperial
    ? { min: Math.ceil(inchesFromCm(HEIGHT_CM.min)), max: Math.floor(inchesFromCm(HEIGHT_CM.max)) }
    : HEIGHT_CM;
  const weightRange = imperial
    ? { min: Math.ceil(poundsFromKg(WEIGHT_KG.min)), max: Math.floor(poundsFromKg(WEIGHT_KG.max)) }
    : WEIGHT_KG;
  const bodyUsable =
    heightCm !== null && weightKg !== null && !invalid.includes('height') && !invalid.includes('weight');
  const bmiText = bodyUsable ? bmiShown(bmiOf(heightCm, weightKg), i18n.language) : '—';

  const sexNames: Record<Sex, string> = {
    female: t('profile.female'),
    male: t('profile.male'),
    preferNot: t('profile.preferNot'),
  };
  const problems = [
    ageYears !== null && ageYears < MIN_APP_AGE ? t('profile.ageTooYoung') : null,
    invalid.includes('age') ? t('profile.ageInvalid') : null,
    invalid.includes('height') || unreadable.height
      ? t('profile.heightInvalid', { ...heightRange, unit: heightUnit })
      : null,
    invalid.includes('weight') || unreadable.weight
      ? t('profile.weightInvalid', { ...weightRange, unit: weightUnit })
      : null,
    invalid.includes('bmi') ? t('profile.bmiInvalid') : null,
  ];

  return (
    <View style={{ gap: spacing.sm }}>
      <Card flush>
        <FieldRow
          label={t('profile.age')}
          suffix={t('profile.years')}
          placeholder={t('profile.agePlaceholder')}
          text={ageText}
          onChangeText={typeAge}
          maxLength={3}
          wholeNumber
        />
        <PickerRow
          label={t('profile.sex')}
          shown={draft.sex === null ? t('profile.notAnswered') : sexNames[draft.sex]}
          selected={draft.sex}
          onSelect={(sex: Sex) => change('sex', sex)}
          options={[
            { value: 'female', label: sexNames.female },
            { value: 'male', label: sexNames.male },
            { value: 'preferNot', label: sexNames.preferNot },
          ]}
        />
        <PickerRow
          label={t('profile.units')}
          shown={imperial ? t('profile.unitsImperial') : t('profile.unitsMetric')}
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
        <FieldRow
          label={t('profile.weight')}
          suffix={weightUnit}
          text={weightText}
          onChangeText={typeWeight}
          maxLength={5}
        />
        <ListRow
          last
          title={t('profile.bmi')}
          subtitle={t('profile.bmiNote')}
          trailing={
            <AppText tone="textDim" accessibilityLabel={`${t('profile.bmi')} ${bmiText}`}>
              {bmiText}
            </AppText>
          }
        />
      </Card>
      {problems.map((message) => (message === null ? null : <Problem key={message} message={message} />))}
    </View>
  );
}

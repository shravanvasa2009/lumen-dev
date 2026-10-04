import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { RiskDraft } from './diabetesRisk';

type QuestionField = 'familyHistory' | 'hypertension' | 'physicallyActive' | 'gestationalDiabetes';

type DiabetesRiskFormProps = {
  draft: RiskDraft;
  onAnswer: (field: QuestionField, answer: boolean) => void;
};

function YesNoQuestion({
  question,
  answer,
  note,
  onAnswer,
}: {
  question: string;
  answer: boolean | null;
  note?: string;
  onAnswer: (answer: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors, control, radius, spacing } = useTheme();
  const options = [
    { value: true, label: t('common.yes') },
    { value: false, label: t('common.no') },
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="headline">{question}</AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={question}
        style={{ flexDirection: 'row', gap: spacing.md }}
      >
        {options.map(({ value, label }) => {
          const selected = answer === value;
          return (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() => onAnswer(value)}
              style={{
                flex: 1,
                minHeight: control.primaryButtonHeight,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                borderRadius: radius.card,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.accent : colors.line,
                backgroundColor: selected ? colors.surface3 : colors.surface2,
              }}
            >
              {selected ? <Icon name="check" size={18} color={colors.accent} /> : null}
              <AppText variant="headline" tone={selected ? 'accent' : 'text'}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {note ? (
        <AppText variant="caption" tone="textDim">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

// The pregnancy question is only for people who chose Female; it is stored but never scored.
export function DiabetesRiskForm({ draft, onAnswer }: DiabetesRiskFormProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xl }}>
      <YesNoQuestion
        question={t('dr.family')}
        answer={draft.familyHistory}
        onAnswer={(answer) => onAnswer('familyHistory', answer)}
      />
      <YesNoQuestion
        question={t('dr.bp')}
        answer={draft.hypertension}
        onAnswer={(answer) => onAnswer('hypertension', answer)}
      />
      <YesNoQuestion
        question={t('dr.active')}
        answer={draft.physicallyActive}
        onAnswer={(answer) => onAnswer('physicallyActive', answer)}
      />
      {draft.sex === 'female' ? (
        <YesNoQuestion
          question={t('dr.gdm')}
          answer={draft.gestationalDiabetes}
          note={t('dr.gdmNote')}
          onAnswer={(answer) => onAnswer('gestationalDiabetes', answer)}
        />
      ) : null}
    </View>
  );
}

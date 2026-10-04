import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { BasicsFields } from '@/profile/BasicsFields';
import { basicsAcceptable, bmiOf } from '@/profile/diabetesRisk';
import { DiabetesRiskForm } from '@/profile/DiabetesRiskForm';
import { bmiShown, scoreDraft } from '@/profile/riskScore';
import { useRiskDraft } from '@/profile/useRiskDraft';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

export default function SettingsProfileScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const risk = useRiskDraft();
  const [editing, setEditing] = useState(false);
  const { draft } = risk;
  const notAnswered = t('profile.notAnswered');
  const yesNo = (answer: boolean | null) =>
    answer === null ? notAnswered : answer ? t('common.yes') : t('common.no');
  const sexNames = {
    female: t('profile.female'),
    male: t('profile.male'),
    preferNot: t('profile.preferNot'),
  };
  const { heightCm, weightKg } = draft;

  async function finishEditing() {
    if (await risk.persist()) setEditing(false);
  }

  const value = (text: string) => <AppText variant="headline">{text}</AppText>;
  const basicsRows = [
    {
      title: t('profile.age'),
      shown: draft.ageYears === null ? notAnswered : `${draft.ageYears} ${t('profile.years')}`,
    },
    { title: t('profile.sex'), shown: draft.sex === null ? notAnswered : sexNames[draft.sex] },
    { title: t('profile.height'), shown: draft.heightCm === null ? notAnswered : `${draft.heightCm} cm` },
    { title: t('profile.weight'), shown: draft.weightKg === null ? notAnswered : `${draft.weightKg} kg` },
    {
      title: t('profile.bmi'),
      shown: heightCm !== null && weightKg !== null ? bmiShown(bmiOf(heightCm, weightKg)) : notAnswered,
    },
  ];
  const questionRows = [
    { title: t('dr.family'), shown: yesNo(draft.familyHistory) },
    { title: t('dr.bp'), shown: yesNo(draft.hypertension) },
    { title: t('dr.active'), shown: yesNo(draft.physicallyActive) },
    ...(draft.sex === 'female'
      ? [{ title: t('dr.gdmShort'), shown: yesNo(draft.gestationalDiabetes), subtitle: t('dr.notScored') }]
      : []),
  ];

  const score = scoreDraft(draft);
  const flagged = score.kind === 'scored' && score.risk.flagged;
  const scoreRow =
    score.kind === 'scored'
      ? {
          subtitle: [t('dr.cutoff'), score.sexNotGiven ? t('dr.minimum') : null].filter(Boolean).join(' · '),
          trailing: (
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="headline" style={flagged ? { color: colors.flag } : undefined}>
                {flagged ? t('dr.result.higher') : t('dr.result.lower')}
              </AppText>
              <AppText variant="caption" tone="textDim">
                {t('dr.score', { points: score.risk.points })}
              </AppText>
            </View>
          ),
        }
      : score.kind === 'under20'
        ? { subtitle: undefined, trailing: value(t('dr.noScore')) }
        : { subtitle: t('dr.notReady'), trailing: undefined };

  return (
    <RouteShell title={t('profile.settingsTitle')}>
      {!risk.loaded ? null : editing ? (
        <View style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('profile.basics')}</SectionLabel>
            <BasicsFields draft={draft} change={risk.change} />
          </View>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('profile.diabetesRisk')}</SectionLabel>
            <DiabetesRiskForm
              draft={draft}
              onAnswer={(field, answer) => {
                risk.change(field, answer);
                // A tap stores only the questions; the basics are checked and stored by Done.
                void risk.persist('questions');
              }}
            />
          </View>
          <Button
            label={t('common.done')}
            disabled={!basicsAcceptable(draft)}
            onPress={() => void finishEditing()}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('profile.basics')}</SectionLabel>
            <Card flush>
              {basicsRows.map(({ title, shown }, index) => (
                <ListRow
                  key={title}
                  title={title}
                  last={index === basicsRows.length - 1}
                  trailing={value(shown)}
                />
              ))}
            </Card>
          </View>
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('profile.diabetesRisk')}</SectionLabel>
            <Card flush>
              {questionRows.map(({ title, shown, subtitle }) => (
                <ListRow key={title} title={title} subtitle={subtitle} trailing={value(shown)} />
              ))}
              <ListRow
                last
                title={t('dr.lastScore')}
                subtitle={scoreRow.subtitle}
                trailing={scoreRow.trailing}
              />
            </Card>
          </View>
          <Button variant="link" label={t('dr.edit')} onPress={() => setEditing(true)} />
          <AppText variant="caption" tone="textDim">
            {t('dr.screeningNote')}
          </AppText>
        </View>
      )}
      {risk.loadFailed ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {t('profile.loadFailed')}
        </AppText>
      ) : null}
      {risk.saveFailed ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {t('profile.saveFailed')}
        </AppText>
      ) : null}
    </RouteShell>
  );
}

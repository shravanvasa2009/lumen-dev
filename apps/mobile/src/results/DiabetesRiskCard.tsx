import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { ListRow } from '@/components/ListRow';
import { bmiShown } from '@/profile/diabetesRisk';
import { useStoredRiskScore, type RiskScore } from '@/profile/riskScore';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

type Scored = Extract<RiskScore, { kind: 'scored' }>;

// The label shows the person's own value; the points come from adaRisk's breakdown and nowhere else.
function breakdownRows(t: TFunction, score: Scored): { label: string; points: number }[] {
  const { answers, risk, sexNotGiven } = score;
  const { breakdown } = risk;
  const yesNo = (answer: boolean) => (answer ? t('common.yes') : t('common.no'));
  const sexLabel = sexNotGiven
    ? t('dr.row.sex.notCounted')
    : answers.male
      ? t('dr.row.sex.male')
      : t('dr.row.sex.female');
  return [
    { label: t('dr.row.age', { age: answers.ageYears }), points: breakdown.age },
    { label: sexLabel, points: breakdown.sex },
    { label: t('dr.row.family', { answer: yesNo(answers.familyHistory) }), points: breakdown.familyHistory },
    { label: t('dr.row.bp', { answer: yesNo(answers.hypertension) }), points: breakdown.hypertension },
    {
      label: t('dr.row.active', { answer: yesNo(answers.physicallyActive) }),
      points: breakdown.physicallyActive,
    },
    { label: t('dr.row.bmi', { bmi: bmiShown(answers.bmi) }), points: breakdown.bmi },
  ];
}

// ADR 0087, 0090: the questionnaire is the diabetes result. The higher-risk heading uses the amber flag
// tokens and never red (SAFE-1); the tag comes from the evidence reader (EVID-1).
export function DiabetesRiskCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const score = useStoredRiskScore();
  if (score === null) return null;

  const flagged = score.kind === 'scored' && score.risk.flagged;
  const headings = {
    scored: { title: flagged ? t('dr.result.higher') : t('dr.result.lower'), line: undefined },
    under20: { title: t('dr.noScore'), line: t('dr.under20') },
    notReady: { title: t('dr.notReady'), line: undefined },
    loadFailed: { title: t('profile.loadFailed'), line: undefined },
  } as const;
  const { title } = headings[score.kind];
  const line =
    score.kind === 'scored'
      ? flagged
        ? t('dr.result.higherSub')
        : t('dr.result.lowerSub')
      : headings[score.kind].line;
  const editRoute = '/settings/profile';
  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          borderLeftWidth: 4,
          borderLeftColor: flagged ? colors.flag : colors.line2,
          paddingLeft: spacing.md,
          gap: spacing.xs,
        }}
      >
        <AppText tone="textDim">{t('checks.diabetes.name')}</AppText>
        <AppText
          variant="title"
          accessibilityRole="header"
          style={flagged ? { color: colors.flag } : undefined}
        >
          {title}
        </AppText>
        {line ? <AppText>{line}</AppText> : null}
        {score.kind === 'scored' ? (
          <AppText variant="caption" tone="textDim">
            {[t('dr.score', { points: score.risk.points }), t('dr.cutoff')].join(' · ')}
          </AppText>
        ) : null}
        {score.kind === 'scored' && score.sexNotGiven ? (
          <AppText variant="caption" tone="textDim">
            {t('dr.minimum')}
          </AppText>
        ) : null}
      </View>

      {score.kind === 'loadFailed' ? null : score.kind === 'notReady' ? (
        <Button variant="link" label={t('dr.notReadyLink')} onPress={() => router.push(editRoute)} />
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" tone="textDim">
              {t('dr.screeningNote')} {t('dr.basedOn')}
            </AppText>
            <EvidenceBadge metric="questionnaire" />
          </View>
          {score.kind === 'scored' ? (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel>{t('dr.howItAdds')}</SectionLabel>
              <Card flush>
                {breakdownRows(t, score).map(({ label, points }, index, rows) => (
                  <ListRow
                    key={label}
                    title={label}
                    last={index === rows.length - 1 && !score.pregnancyAnswered}
                    trailing={<AppText variant="headline">{t('dr.points', { count: points })}</AppText>}
                  />
                ))}
                {score.pregnancyAnswered ? (
                  <ListRow
                    last
                    title={t('dr.gdmShort')}
                    trailing={
                      <AppText tone="textDim" variant="caption">
                        {t('dr.notScored')}
                      </AppText>
                    }
                  />
                ) : null}
              </Card>
            </View>
          ) : null}
          <Button variant="link" label={`${t('dr.edit')} ›`} onPress={() => router.push(editRoute)} />
        </>
      )}
    </View>
  );
}

import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { bmiShown } from '@/profile/diabetesRisk';
import { useStoredRiskScore, type RiskScore } from '@/profile/riskScore';
import { SectionLabel } from '@/settings/SectionLabel';

import { RiskGauge } from './RiskGauge';
import { useTheme } from '@/theme';

type Scored = Extract<RiskScore, { kind: 'scored' }>;

// The label shows the person's own value; the points come from adaRisk's breakdown and nowhere else.
function breakdownRows(
  t: TFunction,
  language: string,
  score: Scored,
): { label: string; points: number; icon: IconName }[] {
  const { answers, risk, sexNotGiven } = score;
  const { breakdown } = risk;
  const yesNo = (answer: boolean) => (answer ? t('common.yes') : t('common.no'));
  const sexLabel = sexNotGiven
    ? t('dr.row.sex.notCounted')
    : answers.male
      ? t('dr.row.sex.male')
      : t('dr.row.sex.female');
  return [
    { label: t('dr.row.age', { age: answers.ageYears }), points: breakdown.age, icon: 'calendar' },
    { label: sexLabel, points: breakdown.sex, icon: 'person' },
    {
      label: t('dr.row.family', { answer: yesNo(answers.familyHistory) }),
      points: breakdown.familyHistory,
      icon: 'people',
    },
    {
      label: t('dr.row.bp', { answer: yesNo(answers.hypertension) }),
      points: breakdown.hypertension,
      icon: 'gauge',
    },
    {
      label: t('dr.row.active', { answer: yesNo(answers.physicallyActive) }),
      points: breakdown.physicallyActive,
      icon: 'walk',
    },
    {
      label: t('dr.row.bmi', { bmi: bmiShown(answers.bmi, language) }),
      points: breakdown.bmi,
      icon: 'scale',
    },
  ];
}

// ADR 0087, 0090: the questionnaire is the diabetes result. The higher-risk heading uses the amber flag
// tokens and never red (SAFE-1); the tag comes from the evidence reader (EVID-1).
export function DiabetesRiskCard() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, radius, shadow, spacing } = useTheme();
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
  const plainHeading = (
    <View
      style={{
        borderLeftWidth: 4,
        borderLeftColor: colors.line2,
        paddingLeft: spacing.md,
        gap: spacing.xs,
      }}
    >
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {line ? <AppText>{line}</AppText> : null}
    </View>
  );
  return (
    <View style={{ gap: spacing.lg }}>
      {score.kind === 'scored' ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.sheet,
            padding: spacing.lg,
            alignItems: 'center',
            ...shadow.raised,
          }}
        >
          <RiskGauge
            points={score.risk.points}
            pointsWord={t('dr.pointsWord', { count: score.risk.points })}
            higherLabel={t('dr.gaugeHigher')}
            lowerEnd={t('dr.gaugeLower')}
            higherEnd={t('dr.gaugeHigherEnd')}
            label={`${title}. ${t('dr.score', { points: score.risk.points })}. ${t('dr.cutoff')}`}
          />
          <AppText
            accessibilityRole="header"
            style={{
              marginTop: spacing.xs,
              fontSize: 28,
              lineHeight: 34,
              fontWeight: '700',
              color: flagged ? colors.flag : colors.accent,
            }}
          >
            {title}
          </AppText>
          {line ? <AppText style={{ marginTop: spacing.xs, textAlign: 'center' }}>{line}</AppText> : null}
          <AppText variant="caption" tone="textDim" style={{ marginTop: spacing.xs, textAlign: 'center' }}>
            {[t('dr.score', { points: score.risk.points }), t('dr.cutoff')].join(' · ')}
          </AppText>
          {score.sexNotGiven ? (
            <AppText variant="caption" tone="textDim" style={{ marginTop: spacing.xs, textAlign: 'center' }}>
              {t('dr.minimum')}
            </AppText>
          ) : null}
        </View>
      ) : (
        plainHeading
      )}

      {score.kind === 'loadFailed' ? null : score.kind === 'notReady' ? (
        <Button variant="link" label={t('dr.notReadyLink')} onPress={() => router.push(editRoute)} />
      ) : (
        <>
          <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            <AppText variant="caption" tone="textDim">
              {t('dr.screeningNote')} {t('dr.basedOn')}
            </AppText>
            <EvidenceBadge metric="questionnaire" />
          </View>
          {score.kind === 'scored' ? (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel>{t('dr.howItAdds')}</SectionLabel>
              <Card flush>
                {breakdownRows(t, i18n.language, score).map(({ label, points, icon }, index, rows) => (
                  <ListRow
                    key={label}
                    title={label}
                    leading={<Icon name={icon} size={22} color={colors.accent} />}
                    last={index === rows.length - 1 && !score.pregnancyAnswered}
                    trailing={
                      <AppText style={{ fontSize: 20, lineHeight: 24, fontWeight: '700' }}>
                        {String(points)}
                        <AppText variant="subheadline" tone="textDim">
                          {` ${t('dr.pointsWord', { count: points })}`}
                        </AppText>
                      </AppText>
                    }
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

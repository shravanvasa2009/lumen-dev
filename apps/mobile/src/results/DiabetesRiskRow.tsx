import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { useStoredRiskScore } from '@/profile/riskScore';
import { useTheme } from '@/theme';

type RowLook = { subtitle: string; trailing?: ReactNode; editable: boolean };

function RowFrame({ readingId, look }: { readingId: string; look: RowLook }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Card flush>
      <ListRow
        last={!look.editable}
        chevron
        title={t('dr.rowTitle')}
        leading={<Icon name="drop" size={22} color={colors.accent} />}
        subtitle={look.subtitle}
        trailing={look.trailing}
        onPress={() => router.push(`/results/${readingId}/diabetes`)}
      />
      {look.editable ? (
        <Button variant="link" label={`${t('dr.edit')} ›`} onPress={() => router.push('/settings/profile')} />
      ) : null}
    </Card>
  );
}

// The score cell may take at most half the row, so "Riesgo más alto" at large text wraps instead of
// pushing the title off a 360 dp screen.
function StoredAnswersRow({ readingId }: { readingId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const score = useStoredRiskScore();
  if (score === null) return null;
  if (score.kind === 'scored') {
    const flagged = score.risk.flagged;
    return (
      <RowFrame
        readingId={readingId}
        look={{
          subtitle: t('dr.fromAnswers'),
          editable: true,
          trailing: (
            <View style={{ alignItems: 'flex-end', flexShrink: 1, maxWidth: '50%' }}>
              <AppText
                tone={flagged ? undefined : 'textDim'}
                style={flagged ? { color: colors.flag } : undefined}
              >
                {flagged ? t('dr.result.higher') : t('dr.result.lower')}
              </AppText>
              <AppText variant="subheadline" tone="textDim">
                {t('dr.score', { points: score.risk.points })}
              </AppText>
            </View>
          ),
        }}
      />
    );
  }
  if (score.kind === 'under20')
    return (
      <RowFrame
        readingId={readingId}
        look={{
          subtitle: t('dr.fromAnswers'),
          editable: true,
          trailing: <AppText variant="headline">{t('dr.noScore')}</AppText>,
        }}
      />
    );
  return (
    <RowFrame
      readingId={readingId}
      look={{
        subtitle: score.kind === 'loadFailed' ? t('profile.loadFailed') : t('dr.notReady'),
        editable: score.kind === 'notReady',
      }}
    />
  );
}

// The compact Diabetes risk row on Results (ADR 0082, 0090). It opens the detail screen and shows no
// number unless the questionnaire gave a score. A sample reading is not the person's, so it never reads
// their stored answers.
export function DiabetesRiskRow({ readingId, sample }: { readingId: string; sample: boolean }) {
  const { t } = useTranslation();
  return sample ? (
    <RowFrame readingId={readingId} look={{ subtitle: t('dr.demoRow'), editable: false }} />
  ) : (
    <StoredAnswersRow readingId={readingId} />
  );
}

// ML-6: shown only while the pulse model is Experimental and the reading has an estimate. No number. It is a row
// of the Experimental group on Results.
export function PulseExtraRow({ readingId }: { readingId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <ListRow
      last
      chevron
      title={t('results.pulsePattern')}
      subtitle={t('results.notDiabetesTest')}
      onPress={() => router.push(`/results/${readingId}/diabetes`)}
    />
  );
}

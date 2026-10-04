import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { useStoredRiskScore } from '@/profile/riskScore';
import { useTheme } from '@/theme';

type RowLook = { subtitle?: string; trailing?: ReactNode };

function RowFrame({ readingId, look }: { readingId: string; look: RowLook }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card flush>
      <ListRow
        last
        chevron
        title={t('dr.rowTitle')}
        subtitle={look.subtitle}
        trailing={look.trailing}
        onPress={() => router.push(`/results/${readingId}/diabetes`)}
      />
    </Card>
  );
}

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
        }}
      />
    );
  }
  if (score.kind === 'under20')
    return (
      <RowFrame
        readingId={readingId}
        look={{ trailing: <AppText variant="headline">{t('dr.noScore')}</AppText> }}
      />
    );
  return (
    <RowFrame
      readingId={readingId}
      look={{ subtitle: score.kind === 'loadFailed' ? t('profile.loadFailed') : t('dr.notReady') }}
    />
  );
}

// The compact Diabetes risk row on Results (ADR 0082, 0090). It opens the detail screen and shows no
// number unless the questionnaire gave a score. A sample reading is not the person's, so it never reads
// their stored answers.
export function DiabetesRiskRow({ readingId, sample }: { readingId: string; sample: boolean }) {
  const { t } = useTranslation();
  return sample ? (
    <RowFrame readingId={readingId} look={{ subtitle: t('dr.demoRow') }} />
  ) : (
    <StoredAnswersRow readingId={readingId} />
  );
}

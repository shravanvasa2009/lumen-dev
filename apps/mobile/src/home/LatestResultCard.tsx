import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import { readingMoment } from './moment';
import type { StoredReading } from './readings';

function headlineOf({ outcome }: StoredReading, t: TFunction): string {
  switch (outcome.headlineKey) {
    case 'result.regular':
      return t('result.regular', {
        hr: outcome.metrics.hr ? Math.round(outcome.metrics.hr.value) : t('home.noValue'),
      });
    case 'result.irregularRetake':
      return t('result.irregularRetake');
    case 'result.possibleAf':
      return t('result.possibleAf');
    case 'result.inconclusive':
      return t('result.inconclusive');
    case 'result.uncertain':
      return t('result.uncertain');
  }
}

type LatestResultCardProps = { reading: StoredReading | null; now: Date };

export function LatestResultCard({ reading, now }: LatestResultCardProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  const headline = reading ? headlineOf(reading, t) : t('home.noReadings');
  const when = reading ? readingMoment(reading.takenAt, now, i18n.language) : null;
  const whenLine = when
    ? when.today
      ? t('home.todayAt', { time: when.time })
      : t('home.dayAt', { date: when.date, time: when.time })
    : t('home.noReadingsBody');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('home.latestResult')}: ${whenLine}. ${headline}`}
      onPress={() => router.push(reading ? `/results/${reading.id}` : '/results/demo')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="textDim">
              {whenLine}
            </AppText>
            <AppText variant="headline">{headline}</AppText>
          </View>
          <Icon name="chevron" size={control.chevronSize} color={colors.textFaint} />
        </View>
      </Card>
    </Pressable>
  );
}

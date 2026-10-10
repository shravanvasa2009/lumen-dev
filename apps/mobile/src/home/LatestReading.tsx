import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { isLowQuality } from '@/results/quality';
import { rhythmClassWords } from '@/results/rhythmWords';
import { useTheme } from '@/theme';

import { readingMoment } from './moment';
import type { StoredReading } from './readings';

type LatestReadingProps = { reading: StoredReading; now: Date };

// The newest saved reading: its headline words, when and how it was taken, and the three vitals it measured.
export function LatestReading({ reading, now }: LatestReadingProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  const { metrics } = reading.outcome;
  const moment = readingMoment(reading.takenAt, now, i18n.language);
  const when = t('home.latestWhen', {
    day: moment.today ? t('home.today') : moment.date,
    time: moment.time,
    mode: reading.mode === 'full' ? t('mode.full') : t('mode.quick'),
  });
  const title = metrics.rhythm ? rhythmClassWords(t, metrics.rhythm.class).value : t('home.latestSaved');
  const vitals = [
    { label: t('home.hr'), metric: metrics.hr, unit: t('home.unitBpm') },
    { label: t('home.hrv'), metric: metrics.rmssd, unit: t('home.unitMs') },
    { label: t('home.breathing'), metric: metrics.resp, unit: t('home.unitBreaths') },
  ];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${when}`}
      onPress={() => router.push(`/results/${reading.id}`)}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name="pulse" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{title}</AppText>
            <AppText variant="caption" tone="textDim">
              {when}
            </AppText>
          </View>
          <Icon name="chevron" size={control.chevronSize} color={colors.textFaint} />
        </View>
        <View
          style={{
            height: 1,
            backgroundColor: colors.line,
            marginVertical: spacing.sm,
          }}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {vitals.map(({ label, metric, unit }) => (
            <View key={label} style={{ flex: 1 }}>
              <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
                {label}
              </AppText>
              <AppText variant="title">
                {metric ? String(Math.round(metric.value)) : t('home.noValue')}
              </AppText>
              <AppText variant="caption" tone="textDim">
                {metric && isLowQuality(metric) ? t('home.lowerQuality') : unit}
              </AppText>
            </View>
          ))}
        </View>
      </Card>
    </PressableScale>
  );
}

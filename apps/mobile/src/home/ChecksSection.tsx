import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { evidenceFor } from '@/evidence';
import { isLowQuality } from '@/results/quality';
import { rhythmClassWords } from '@/results/rhythmWords';
import { useTheme } from '@/theme';

import { DIABETES_DAYS_NEEDED, diabetesProgress, latestRhythm, latestRmssd } from './findings';
import { readingMoment } from './moment';
import type { StoredReading } from './readings';

const FULL_SCAN = '/measure/precheck?mode=full';
const STANDING_TEST = '/measure/standing-test';

type ChecksSectionProps = { readings: readonly StoredReading[]; now: Date };

// Every line comes from a saved reading. A check with no saved result says so instead of guessing.
export function ChecksSection({ readings, now }: ChecksSectionProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const noReadings = t('home.noReadings');
  const whenOf = (reading: StoredReading) => {
    const moment = readingMoment(reading.takenAt, now, i18n.language);
    return moment.today ? t('checks.today') : moment.date;
  };
  const openReading = (reading: StoredReading) => () => router.push(`/results/${reading.id}`);

  const rhythm = latestRhythm(readings);
  const rmssd = latestRmssd(readings);
  const { days, latest: diabetes } = diabetesProgress(readings);
  // ADR 0104: a lower-quality value is never shown without its tag.
  const marked = (metric: object, value: string) =>
    isLowQuality(metric) ? t('quality.marked', { value }) : value;
  const hrvValue = rmssd ? marked(rmssd.metric, String(Math.round(rmssd.metric.value))) : '';
  const band = rmssd?.metric.band;
  const diabetesFinding =
    diabetes?.metric.flag === 'pattern' && evidenceFor('diabetes').measured
      ? t('dm.flag.title')
      : days === 0
        ? noReadings
        : days >= DIABETES_DAYS_NEEDED
          ? t('checks.status.dmDone', { total: DIABETES_DAYS_NEEDED })
          : t('checks.status.dmProgress', { count: days, total: DIABETES_DAYS_NEEDED });

  return (
    <Card flush>
      <CheckRow
        icon="pulse"
        name={t('checks.afib.name')}
        finding={
          rhythm
            ? t('checks.status.withWhen', {
                finding: marked(rhythm.metric, rhythmClassWords(t, rhythm.metric.class).value),
                when: whenOf(rhythm.reading),
              })
            : noReadings
        }
        onPress={rhythm ? openReading(rhythm.reading) : () => router.push(FULL_SCAN)}
      />
      <CheckRow
        icon="bars"
        name={t('checks.hrv.name')}
        finding={
          rmssd
            ? band
              ? t('checks.status.hrvBand', {
                  value: hrvValue,
                  low: Math.round(band[0]),
                  high: Math.round(band[1]),
                })
              : t('checks.status.hrv', { value: hrvValue })
            : noReadings
        }
        onPress={rmssd ? () => router.push('/trends') : () => router.push(FULL_SCAN)}
      />
      <CheckRow
        icon="drop"
        name={t('checks.diabetes.name')}
        finding={diabetesFinding}
        onPress={diabetes ? openReading(diabetes.reading) : () => router.push(FULL_SCAN)}
      />
      <CheckRow
        icon="standing"
        name={t('checks.pots.name')}
        finding={t('checks.status.potsNone')}
        onPress={() => router.push(STANDING_TEST)}
        last
      />
    </Card>
  );
}

type CheckRowProps = { icon: IconName; name: string; finding: string; onPress: () => void; last?: boolean };

function CheckRow({ icon, name, finding, onPress, last }: CheckRowProps) {
  const { colors } = useTheme();
  return (
    <ListRow
      title={name}
      subtitle={finding}
      leading={<Icon name={icon} size={22} color={colors.accent} />}
      chevron
      last={last}
      onPress={onPress}
    />
  );
}

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { evidenceFor } from '@/evidence';
import { rhythmClassWords } from '@/results/rhythmWords';
import { useTheme } from '@/theme';

import { CheckCard } from './CheckCard';
import { DIABETES_DAYS_NEEDED, diabetesProgress, latestRhythm, latestRmssd } from './findings';
import { readingMoment } from './moment';
import type { StoredReading } from './readings';

const FULL_SCAN = '/measure/precheck?mode=full';
const STANDING_TEST = '/measure/standing-test';

type ChecksSectionProps = { readings: readonly StoredReading[]; now: Date; compact: boolean };

// Every line comes from a saved reading. A check with no saved result says so instead of guessing.
export function ChecksSection({ readings, now, compact }: ChecksSectionProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const noReadings = t('home.noReadings');
  const whenOf = (reading: StoredReading) => {
    const moment = readingMoment(reading.takenAt, now, i18n.language);
    return moment.today ? t('checks.today') : moment.date;
  };
  const openReading = (reading: StoredReading) => () => router.push(`/results/${reading.id}`);

  const rhythm = latestRhythm(readings);
  const rmssd = latestRmssd(readings);
  const { days, latest: diabetes } = diabetesProgress(readings);
  const hrvValue = rmssd ? String(Math.round(rmssd.metric.value)) : '';
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
    <View style={{ gap: compact ? spacing.xs : spacing.sm }}>
      <CheckCard
        compact={compact}
        icon="pulse"
        name={t('checks.afib.name')}
        evidence="rhythm"
        finding={
          rhythm
            ? t('checks.status.withWhen', {
                finding: rhythmClassWords(t, rhythm.metric.class).value,
                when: whenOf(rhythm.reading),
              })
            : noReadings
        }
        onOpenFinding={rhythm ? openReading(rhythm.reading) : undefined}
        onScan={() => router.push(FULL_SCAN)}
      />
      <CheckCard
        compact={compact}
        icon="bars"
        name={t('checks.hrv.name')}
        evidence="hrv"
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
        onOpenFinding={rmssd ? openReading(rmssd.reading) : undefined}
        onScan={() => router.push(FULL_SCAN)}
      />
      <CheckCard
        compact={compact}
        icon="drop"
        name={t('checks.diabetes.name')}
        evidence="diabetes"
        finding={diabetesFinding}
        onOpenFinding={diabetes ? openReading(diabetes.reading) : undefined}
        onScan={() => router.push(FULL_SCAN)}
      />
      <CheckCard
        compact={compact}
        icon="standing"
        name={t('checks.pots.name')}
        finding={t('checks.status.potsNone')}
        onScan={() => router.push(STANDING_TEST)}
      />
    </View>
  );
}

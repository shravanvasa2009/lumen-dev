import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';
import { DiabetesCheckCard, showsPulseExtra } from '@/results/DiabetesCheckCard';
import { DiabetesRiskCard } from '@/results/DiabetesRiskCard';
import { useResultsReading } from '@/results/useResultsReading';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

// ADR 0090 addendum 1: the full diabetes result for one reading. A sample reading is not the person's,
// so it explains that instead of reading their stored answers.
export default function DiabetesResultScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = useResultsReading(id);
  if (reading === undefined) return <RouteShell title={t('results.title')} />;
  // An id with no saved reading shows no score, as the Results and Why screens do.
  if (reading === null) return <RouteShell title={t('results.title')} subtitle={t('result.inconclusive')} />;
  return (
    <RouteShell title={t('dr.rowTitle')}>
      <View style={{ gap: spacing.xl }}>
        {reading.sample ? <AppText tone="textDim">{t('dr.demoRow')}</AppText> : <DiabetesRiskCard />}
        {showsPulseExtra(reading) ? <DiabetesCheckCard /> : null}
        {reading.mode !== 'full' ? (
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('dr.pulseExtra')}</SectionLabel>
            <AppText tone="textDim">{t('dr.pulseNeedsFull')}</AppText>
          </View>
        ) : null}
      </View>
    </RouteShell>
  );
}

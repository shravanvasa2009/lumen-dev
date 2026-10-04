import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';
import { DiabetesCheckCard, showsPulseExtra } from '@/results/DiabetesCheckCard';
import { DiabetesRiskCard } from '@/results/DiabetesRiskCard';
import { useResultsReading } from '@/results/useResultsReading';
import { useTheme } from '@/theme';

// ADR 0090 addendum 1: the full diabetes result for one reading. A sample reading is not the person's,
// so it explains that instead of reading their stored answers.
export default function DiabetesResultScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = useResultsReading(id);
  return (
    <RouteShell title={t('dr.rowTitle')}>
      {reading === undefined ? null : (
        <View style={{ gap: spacing.xl }}>
          {reading?.sample ? <AppText tone="textDim">{t('dr.demoRow')}</AppText> : <DiabetesRiskCard />}
          {reading && showsPulseExtra(reading) ? <DiabetesCheckCard /> : null}
        </View>
      )}
    </RouteShell>
  );
}

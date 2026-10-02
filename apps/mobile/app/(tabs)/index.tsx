import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { LatestResultCard } from '@/home/LatestResultCard';
import { MeasureButton } from '@/home/MeasureButton';
import { MetricTile } from '@/home/MetricTile';
import { dateLine, dayPeriod } from '@/home/moment';
import { latestReading, type StoredReading, tileSeries } from '@/home/readings';
import { WidgetPromo } from '@/home/WidgetPromo';
import { durationLabel } from '@/measure/durationLabel';
import { DEFAULT_MODE, MODES } from '@/measure/mode';
import { useTheme } from '@/theme';

// Nothing saves readings on the phone yet, so Home has none to show; this stays empty until storage lands.
const noStoredReadingsYet: readonly StoredReading[] = [];

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const [promoDismissed, setPromoDismissed] = useState(false);
  const now = new Date();
  const greetings = {
    morning: t('home.greetingMorning'),
    afternoon: t('home.greetingAfternoon'),
    evening: t('home.greetingEvening'),
  };
  const modeNames = { quick: t('mode.quick'), full: t('mode.full') };
  const modeLabel = t('home.modeLine', {
    mode: modeNames[DEFAULT_MODE],
    seconds: durationLabel(t, MODES[DEFAULT_MODE].duration),
  });

  return (
    <Screen headerless>
      <ScrollView contentContainerStyle={{ flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.lg }}>
        <View>
          <AppText tone="textDim">{dateLine(now, i18n.language)}</AppText>
          <AppText variant="display" accessibilityRole="header">
            {greetings[dayPeriod(now.getHours())]}
          </AppText>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <MeasureButton
            label={t('home.measure')}
            modeLabel={modeLabel}
            onPress={() => router.push('/measure/mode')}
          />
          <NavButton label={t('home.changeMode')} href="/measure/mode" variant="link" />
        </View>
        <LatestResultCard reading={latestReading(noStoredReadingsYet)} now={now} />
        {promoDismissed ? null : <WidgetPromo onDismiss={() => setPromoDismissed(true)} />}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <MetricTile
            label={t('home.restingHr')}
            unit={t('home.unitBpm')}
            points={tileSeries(noStoredReadingsYet, 'hr')}
          />
          <MetricTile
            label={t('home.hrv')}
            unit={t('home.unitMs')}
            points={tileSeries(noStoredReadingsYet, 'rmssd')}
          />
          <MetricTile
            label={t('home.breathing')}
            unit={t('home.unitPerMin')}
            points={tileSeries(noStoredReadingsYet, 'resp')}
          />
        </View>
        <NavButton label={t('home.followUp')} href="/follow-up" variant="link" />
      </ScrollView>
    </Screen>
  );
}

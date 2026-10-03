import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useDemoActive } from '@/demo/demoSession';
import { LatestResultCard } from '@/home/LatestResultCard';
import { MeasureButton } from '@/home/MeasureButton';
import { MetricTile } from '@/home/MetricTile';
import { dateLine, dayPeriod } from '@/home/moment';
import { latestReading, tileSeries } from '@/home/readings';
import { WidgetPromo } from '@/home/WidgetPromo';
import { durationLabel } from '@/measure/durationLabel';
import { DEFAULT_MODE, MODES } from '@/measure/mode';
import { useOnboardingState } from '@/profile/onboarding';
import { useStoredReadings } from '@/store/useStoredReadings';
import { useTheme } from '@/theme';

// A fresh install opens on Welcome. "Try demo mode" starts the in-memory demo session (src/demo), which skips
// the gate for as long as it lasts without recording that onboarding is done, so the next launch still starts
// at Welcome. Only the launch screen is gated: a widget or notification link (lumen://check) opens its own
// screen directly, which a person who never finished onboarding can reach, and Home then sends them to Welcome.
export default function HomeScreen() {
  const demo = useDemoActive();
  const onboarding = useOnboardingState();
  if (!demo) {
    if (onboarding === 'loading') return null;
    if (onboarding === 'needed') return <Redirect href="/welcome" />;
  }
  return <Home />;
}

function Home() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const readings = useStoredReadings();
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
        <LatestResultCard reading={latestReading(readings)} now={now} />
        {promoDismissed ? null : <WidgetPromo onDismiss={() => setPromoDismissed(true)} />}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <MetricTile
            label={t('home.restingHr')}
            unit={t('home.unitBpm')}
            points={tileSeries(readings, 'hr')}
          />
          <MetricTile label={t('home.hrv')} unit={t('home.unitMs')} points={tileSeries(readings, 'rmssd')} />
          <MetricTile
            label={t('home.breathing')}
            unit={t('home.unitPerMin')}
            points={tileSeries(readings, 'resp')}
          />
        </View>
        <NavButton label={t('home.followUp')} href="/follow-up" variant="link" />
      </ScrollView>
    </Screen>
  );
}

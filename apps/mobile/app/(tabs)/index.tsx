import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useDemoActive } from '@/demo/demoSession';
import { ChecksSection } from '@/home/ChecksSection';
import { MeasureButton } from '@/home/MeasureButton';
import { MetricTile } from '@/home/MetricTile';
import { dateLine, dayPeriod } from '@/home/moment';
import { tileSeries } from '@/home/readings';
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

// Below this window height (a 360 x 640 phone) the layout follows mockup 10-home.small: a 164 dp Measure (131 dp disc; 256 dp otherwise), no date line,
// compact check cards and tiles, so the four checks and the tiles fit without scrolling.
const COMPACT_HEIGHT = 700;
const MEASURE_SIZE = 320;
const COMPACT_GREETING_LINE = 34;
// The link's 44 dp target tucks under the Measure halo, which is transparent at its edge.
const COMPACT_LINK_OVERLAP = 24;
const MEASURE_SIZE_COMPACT = 164;

function Home() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const readings = useStoredReadings();
  const { spacing } = useTheme();
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_HEIGHT;
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
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: compact ? spacing.xs : spacing.md,
          paddingBottom: spacing.lg,
        }}
      >
        <View>
          {compact ? null : <AppText tone="textDim">{dateLine(now, i18n.language)}</AppText>}
          <AppText
            variant="display"
            accessibilityRole="header"
            style={compact ? { lineHeight: COMPACT_GREETING_LINE } : undefined}
          >
            {greetings[dayPeriod(now.getHours())]}
          </AppText>
        </View>
        <View style={{ alignItems: 'center', marginTop: compact ? -spacing.sm : 0 }}>
          <MeasureButton
            label={t('home.measure')}
            modeLabel={modeLabel}
            size={compact ? MEASURE_SIZE_COMPACT : MEASURE_SIZE}
            onPress={() => router.push('/measure/mode')}
          />
          <View style={{ marginTop: compact ? -COMPACT_LINK_OVERLAP : 0 }}>
            <NavButton label={t('home.changeMode')} href="/measure/mode" variant="link" />
          </View>
        </View>
        <ChecksSection readings={readings} now={now} compact={compact} />
        <View style={{ flexDirection: 'row', gap: compact ? spacing.sm : spacing.md }}>
          <MetricTile
            label={t('home.restingHr')}
            unit={t('home.unitBpm')}
            points={tileSeries(readings, 'hr')}
            compact={compact}
          />
          <MetricTile
            label={t('home.hrv')}
            unit={t('home.unitMs')}
            points={tileSeries(readings, 'rmssd')}
            compact={compact}
          />
          <MetricTile
            label={t('home.breathing')}
            unit={t('home.unitPerMin')}
            points={tileSeries(readings, 'resp')}
            compact={compact}
          />
        </View>
        {promoDismissed ? null : <WidgetPromo onDismiss={() => setPromoDismissed(true)} />}
        <NavButton label={t('home.followUp')} href="/follow-up" variant="link" />
      </ScrollView>
    </Screen>
  );
}

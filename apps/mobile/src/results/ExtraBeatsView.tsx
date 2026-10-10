import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { formatNumber } from '@/i18n/formatNumber';
import { useTheme } from '@/theme';

import { intervalAxis } from './axis';
import { DemoBanner } from './DemoBanner';
import { type FixtureReading, regularIntervalsMs } from './fixtures';
import { RhythmMap } from './RhythmMap';
import { Tachogram } from './Tachogram';

// Extra or skipped beats are an Experimental measure (§6.3): the page gives the rate and the two pictures that
// show how steady the gaps were, with no flag and no claim.
export function ExtraBeatsView({ reading }: { reading: FixtureReading }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const gaps = reading.intervalsMs;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('why.extraBeats') }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xxl, paddingBottom: spacing.lg }}>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <Card>
          <AppText variant="title3">
            {t('why.extraBeatsNote', {
              rate: formatNumber(reading.scan.experimental.extraBeatsPerMin, i18n.language),
            })}
          </AppText>
        </Card>
        {gaps.length > 0 ? (
          <>
            <View style={{ gap: spacing.md }}>
              <AppText variant="title3" accessibilityRole="header">
                {t('why.rhythmMap')}
              </AppText>
              <Card>
                <RhythmMap
                  intervalsMs={gaps}
                  typicalIntervalsMs={regularIntervalsMs}
                  axis={intervalAxis(gaps)}
                  color={colors.accentFill}
                  label={t('why.rhythmMap')}
                />
              </Card>
            </View>
            <View style={{ gap: spacing.md }}>
              <AppText variant="title3" accessibilityRole="header">
                {t('why.intervals')}
              </AppText>
              <Card>
                <Tachogram intervalsMs={gaps} color={colors.accent} />
              </Card>
            </View>
          </>
        ) : null}
        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('prototype.banner')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

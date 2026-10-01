import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { ScoreGauge } from '@/settings/ScoreGauge';
import { useTheme } from '@/theme';

// Point values of the four rating components (spec 5.1).
const MAX_FRAME_RATE = 30;
const MAX_COUPLING = 35;
const MAX_LOCKS = 15;
const MAX_TIMING = 20;

export default function PhoneRatingScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const components = [
    { name: t('phoneRating.frameRate'), max: MAX_FRAME_RATE },
    { name: t('phoneRating.coupling'), max: MAX_COUPLING },
    { name: t('phoneRating.lock'), max: MAX_LOCKS },
    { name: t('phoneRating.timing'), max: MAX_TIMING },
  ];
  return (
    <RouteShell
      title={t('phoneRating.title')}
      footer={
        <>
          <NavButton label={t('phoneRating.retest')} href="/phone-check" />
          <AppText variant="caption" tone="textDim" style={styles.tip}>
            {t('phoneRating.tip')}
          </AppText>
        </>
      }
    >
      <ScoreGauge placeholder={t('phoneRating.noScore')} caption={t('phoneRating.notTested')} />
      <AppText tone="textDim" style={styles.tip}>
        {t('phoneRating.notTestedBody')}
      </AppText>
      <Card>
        {components.map(({ name, max }) => (
          <View key={name} style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <View style={styles.line}>
              <AppText style={styles.name}>{name}</AppText>
              <AppText variant="headline" tone="textDim">
                {t('phoneRating.points', { max })}
              </AppText>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surface3 }]} />
          </View>
        ))}
      </Card>
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  tip: { textAlign: 'center' },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1 },
  track: { height: 6, borderRadius: 3 },
});

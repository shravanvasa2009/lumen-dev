import { Stack, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import type { MeasureMode } from '@/measure/mode';
import { useTheme } from '@/theme';

import type { FixtureReading } from './fixtures';
import { DemoBanner } from './DemoBanner';
import { Glyph } from './Glyph';
import { LostTime, lostCauses, secondsLost } from './LostTime';

function summary(t: TFunction, reading: FixtureReading | undefined): string {
  if (!reading) return t('inconclusive.generic');
  const seconds = reading.scan.cleanSeconds;
  const lost = reading.scan.lostSeconds;
  const [biggest] = [...lostCauses].sort(
    (first, second) => secondsLost(lost, second) - secondsLost(lost, first),
  );
  if (!biggest || secondsLost(lost, biggest) === 0) return t('inconclusive.gotOnly', { seconds });
  const cause = {
    movement: t('inconclusive.causeMovement'),
    pressure: t('inconclusive.causePressure'),
    light: t('inconclusive.causeLight'),
  }[biggest];
  return t('inconclusive.got', { seconds, cause });
}

type InconclusiveViewProps = { reading: FixtureReading | undefined; mode: MeasureMode };

export function InconclusiveView({ reading, mode }: InconclusiveViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        headerless
        footer={
          <>
            <NavButton label={t('inconclusive.retake')} href={`/measure/capture?mode=${mode}`} replace />
            <NavButton
              label={t('inconclusive.fix')}
              href={`/measure/fix-technique?mode=${mode}`}
              variant="secondary"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/measure/capture?mode=quick')}
              style={{ minHeight: control.minTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppText variant="headline" tone="accent">
                {t('inconclusive.tryQuick')}
              </AppText>
            </Pressable>
          </>
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inconclusive.close')}
          hitSlop={spacing.md}
          onPress={() => router.replace('/')}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Glyph name="close" size={control.chevronSize + 4} color={colors.textDim} />
        </Pressable>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg }}>
          {reading ? <DemoBanner synthetic={reading.synthetic} /> : null}
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Glyph name="noSignal" size={56} color={colors.flag} />
            <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('result.inconclusive')}
            </AppText>
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {summary(t, reading)}
            </AppText>
          </View>
          <LostTime lost={reading ? reading.scan.lostSeconds : null} />
          <Card>
            {[t('inconclusive.tipElbows'), t('inconclusive.tipBreathe')].map((tip) => (
              <View key={tip} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Glyph name="hint" size={20} color={colors.accent} />
                <AppText style={{ flex: 1 }}>{tip}</AppText>
              </View>
            ))}
          </Card>
        </View>
      </Screen>
    </>
  );
}

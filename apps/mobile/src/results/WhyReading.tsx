import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

import { type FixtureReading, regularIntervalsMs } from './fixtures';
import { PoincarePlot } from './PoincarePlot';
import { rhythmWords } from './rhythmWords';
import { Tachogram } from './Tachogram';

function SectionCaption({ text }: { text: string }) {
  return (
    <AppText variant="caption" tone="textDim" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
      {text}
    </AppText>
  );
}

export function WhyReading({ reading }: { reading: FixtureReading }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const { rhythm } = reading.scan.metrics;
  if (!rhythm || reading.intervalsMs.length === 0) {
    return (
      <Screen>
        <AppText variant="title" accessibilityRole="header">
          {t('result.inconclusive')}
        </AppText>
      </Screen>
    );
  }

  const irregular = rhythm.class === 'af';
  const seriesColor = rhythm.flag ? colors.flag : colors.accent;
  const words = rhythmWords(t, rhythm);
  const chipColors = rhythm.flag
    ? { fill: colors.badgeFlagBg, text: colors.badgeFlagFg }
    : { fill: colors.surface3, text: colors.text };
  const confidence = {
    high: t('confidence.high'),
    moderate: t('confidence.moderate'),
    low: t('confidence.low'),
  }[rhythm.confidence];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
        <AppText variant="title" accessibilityRole="header">
          {irregular ? t('why.titleIrregular') : t('why.titleRegular')}
        </AppText>

        <SectionCaption text={t('why.intervals')} />
        <Card>
          <Tachogram intervalsMs={reading.intervalsMs} color={seriesColor} />
        </Card>

        <SectionCaption text={t('why.poincare')} />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <PoincarePlot intervalsMs={reading.intervalsMs} color={seriesColor} label={t('why.yours')} />
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('why.yours')}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <PoincarePlot intervalsMs={regularIntervalsMs} color={colors.accent} label={t('why.typical')} />
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('why.typical')}
            </AppText>
          </View>
        </View>

        <Card>
          <AppText>{irregular ? t('why.explainIrregular') : t('why.explainRegular')}</AppText>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <View
              style={{
                backgroundColor: chipColors.fill,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              }}
            >
              <AppText variant="caption" style={{ color: chipColors.text, fontWeight: '600' }}>
                {t('why.rhythmCheck')}
              </AppText>
            </View>
            <AppText tone="textDim" style={{ flex: 1 }}>
              {`${words.note} · ${confidence}`}
            </AppText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <EvidenceBadge metric="rhythm" />
            <AppText
              accessibilityRole="link"
              tone="textDim"
              onPress={() => router.push('/settings/accuracy')}
            >
              {t('results.accuracy')} ›
            </AppText>
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText tone="textDim">{t('why.extraBeats')}</AppText>
            <EvidenceBadge metric="extraBeats" />
          </View>
          <AppText>{t('why.extraBeatsNote', { rate: reading.scan.experimental.extraBeatsPerMin })}</AppText>
        </Card>
      </ScrollView>
    </Screen>
  );
}

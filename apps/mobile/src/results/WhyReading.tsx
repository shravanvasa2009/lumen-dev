import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { formatNumber } from '@/i18n/formatNumber';
import { useTheme } from '@/theme';

import { intervalAxis } from './axis';
import { LowerQualityTag } from './LowerQualityTag';
import { metricReasons, readingQuality } from './quality';
import { DemoBanner } from './DemoBanner';
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
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [poincareOpen, setPoincareOpen] = useState(false);
  const { colors, radius, spacing, control } = useTheme();
  const { rhythm } = reading.scan.metrics;
  if (!rhythm || reading.intervalsMs.length === 0) {
    return (
      <Screen>
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <AppText variant="title" accessibilityRole="header">
          {t('result.inconclusive')}
        </AppText>
      </Screen>
    );
  }

  const why =
    rhythm.class === null
      ? { title: t('results.rhythmTooShort'), explain: t('why.explainTooShort') }
      : {
          af: { title: t('why.titleIrregular'), explain: t('why.explainIrregular') },
          sinus: { title: t('why.titleRegular'), explain: t('why.explainRegular') },
          other: { title: t('why.titleOther'), explain: t('why.explainOther') },
        }[rhythm.class];
  const axis = intervalAxis(reading.intervalsMs);
  const seriesColor = rhythm.flag ? colors.flag : colors.accent;
  // The accent text colour fails contrast on the dark plot panel; the fill teal passes (tokens.json).
  const plotColor = rhythm.flag ? colors.flag : colors.accentFill;
  const words = rhythmWords(t, rhythm);
  const lowReasons = metricReasons(rhythm, readingQuality(reading.scan));
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
        {reading.sample ? <DemoBanner synthetic={reading.synthetic} /> : null}
        <AppText variant="title" accessibilityRole="header">
          {why.title}
        </AppText>
        {lowReasons ? <LowerQualityTag reasons={lowReasons} /> : null}

        <SectionCaption text={t('why.plainWords')} />
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name="pulse" size={control.chevronSize} color={seriesColor} />
            <AppText variant="headline" style={{ flex: 1 }}>
              {why.explain}
            </AppText>
          </View>
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
            <EvidenceBadge metric="rhythm" basicAnalysis={rhythm.scorer === 'rule'} />
            <AppText
              accessibilityRole="link"
              tone="textDim"
              onPress={() => router.push('/settings/accuracy')}
            >
              {t('results.accuracy')} ›
            </AppText>
          </View>
        </Card>

        <SectionCaption text={t('why.seeBeats')} />
        <Card>
          <AppText variant="caption" tone="textDim">
            {t('why.intervals')}
          </AppText>
          <Tachogram intervalsMs={reading.intervalsMs} color={seriesColor} />
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText tone="textDim">{t('why.extraBeats')}</AppText>
            <EvidenceBadge metric="extraBeats" />
          </View>
          <AppText>
            {t('why.extraBeatsNote', {
              rate: formatNumber(reading.scan.experimental.extraBeatsPerMin, i18n.language),
            })}
          </AppText>
        </Card>

        <Card flush>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('why.learnMore')}
            accessibilityState={{ expanded: poincareOpen }}
            onPress={() => setPoincareOpen(!poincareOpen)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.md,
              minHeight: control.minTarget,
              paddingHorizontal: spacing.lg,
            }}
          >
            <AppText variant="headline" importantForAccessibility="no">
              {t('why.poincare')}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <AppText tone="textDim" importantForAccessibility="no">
                {t('why.learnMore')}
              </AppText>
              <View style={{ transform: [{ rotate: poincareOpen ? '-90deg' : '90deg' }] }}>
                <Icon name="chevron" size={control.chevronSize} color={colors.text} />
              </View>
            </View>
          </Pressable>
          {poincareOpen ? (
            <View
              style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingTop: spacing.xs }}
            >
              <View style={{ flex: 1, gap: spacing.sm }}>
                <PoincarePlot
                  intervalsMs={reading.intervalsMs}
                  axis={axis}
                  color={plotColor}
                  label={t('why.yours')}
                />
                <AppText tone="textDim" style={{ textAlign: 'center' }}>
                  {t('why.yours')}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: spacing.sm }}>
                <PoincarePlot
                  intervalsMs={regularIntervalsMs}
                  axis={axis}
                  color={colors.accentFill}
                  label={t('why.typical')}
                />
                <AppText tone="textDim" style={{ textAlign: 'center' }}>
                  {t('why.typical')}
                </AppText>
              </View>
            </View>
          ) : null}
        </Card>

        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('prototype.banner')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

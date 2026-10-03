import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { tierLabel } from '@/rating/labels';
import { RatingGauge } from '@/settings/RatingGauge';
import type { StoredRating } from '@/store/deviceRating';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

// Point values of the four rating components (spec 5.1).
const MAX_FRAME_RATE = 30;
const MAX_COUPLING = 35;
const MAX_LOCKS = 15;
const MAX_TIMING = 20;

type ComponentLine = { name: string; max: number; points: number | null; detail: string | null };

function componentLines(rating: StoredRating | null, t: TFunction): ComponentLine[] {
  const { components, fpsLevel, practice } = rating ?? {};
  const pi = practice?.perfusionIndexPct;
  const jitter = practice?.frameIntervalSdMs;
  return [
    {
      name: t('phoneRating.frameRate'),
      max: MAX_FRAME_RATE,
      points: components?.frameRate ?? null,
      detail:
        fpsLevel === undefined || fpsLevel === null ? null : t('phoneRating.fpsDetail', { fps: fpsLevel }),
    },
    {
      name: t('phoneRating.coupling'),
      max: MAX_COUPLING,
      points: components?.coupling ?? null,
      detail:
        rating === null
          ? null
          : pi == null
            ? t('phoneRating.notMeasured')
            : t('phoneRating.couplingDetail', { pi: pi.toFixed(1) }),
    },
    { name: t('phoneRating.lock'), max: MAX_LOCKS, points: components?.locks ?? null, detail: null },
    {
      name: t('phoneRating.timing'),
      max: MAX_TIMING,
      points: components?.timing ?? null,
      detail:
        rating === null
          ? null
          : jitter == null
            ? t('phoneRating.notMeasured')
            : t('phoneRating.timingDetail', { ms: jitter.toFixed(1) }),
    },
  ];
}

export default function PhoneRatingScreen() {
  const { t, i18n } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const rating = useStoredRating() ?? null;
  const lines = componentLines(rating, t);
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
      {rating === null ? (
        <>
          <RatingGauge score={null} label={t('phoneRating.noScore')} caption={t('phoneRating.notTested')} />
          <AppText tone="textDim" style={styles.tip}>
            {t('phoneRating.notTestedBody')}
          </AppText>
        </>
      ) : (
        <>
          <RatingGauge
            score={rating.score}
            label={String(rating.score)}
            caption={tierLabel(t, rating.tier)}
          />
          <AppText tone="textDim" style={styles.tip}>
            {t('phoneRating.tested', {
              date: new Date(rating.testedAt).toLocaleDateString(i18n.language, {
                month: 'short',
                day: 'numeric',
              }),
            })}
          </AppText>
        </>
      )}
      <Card>
        {lines.map(({ name, max, points, detail }) => (
          <View key={name} style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <View style={[styles.line, { gap: spacing.md }]}>
              <AppText style={styles.name}>{name}</AppText>
              <AppText variant="headline" tone="textDim">
                {points === null ? t('phoneRating.points', { max }) : t('phoneRating.score', { points, max })}
              </AppText>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surface3, borderRadius: radius.pill }]}>
              <View
                style={[
                  styles.track,
                  {
                    width: `${((points ?? 0) / max) * 100}%`,
                    backgroundColor: colors.accentFill,
                    borderRadius: radius.pill,
                  },
                ]}
              />
            </View>
            {detail === null ? null : (
              <AppText variant="caption" tone="textDim">
                {detail}
              </AppText>
            )}
          </View>
        ))}
      </Card>
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  tip: { textAlign: 'center' },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  name: { flex: 1 },
  track: { height: 6 },
});

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { tierLabel } from '@/rating/labels';
import { RatingGauge } from '@/settings/RatingGauge';
import { SectionLabel } from '@/settings/SectionLabel';
import type { StoredRating } from '@/store/deviceRating';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

// Point values of the four rating components (spec 5.1).
const MAX_FRAME_RATE = 30;
const MAX_COUPLING = 35;
const MAX_LOCKS = 15;
const MAX_TIMING = 20;

// Frame timing has no glyph that fits yet, so its row keeps an empty tile.
type ComponentLine = { icon: IconName | null; name: string; max: number; points: number | null; detail: string | null };

function componentLines(rating: StoredRating | null, t: TFunction): ComponentLine[] {
  const { components, fpsLevel, practice } = rating ?? {};
  const pi = practice?.perfusionIndexPct;
  const jitter = practice?.frameIntervalSdMs;
  return [
    {
      icon: 'pulse',
      name: t('phoneRating.frameRate'),
      max: MAX_FRAME_RATE,
      points: components?.frameRate ?? null,
      detail:
        fpsLevel === undefined || fpsLevel === null ? null : t('phoneRating.fpsDetail', { fps: fpsLevel }),
    },
    {
      icon: 'finger',
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
    { icon: 'lock', name: t('phoneRating.lock'), max: MAX_LOCKS, points: components?.locks ?? null, detail: null },
    {
      icon: null,
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
  const retest = <NavButton label={t('phoneRating.retest')} href="/phone-check" />;
  return (
    <RouteShell
      title={t('phoneRating.title')}
      footer={
        rating === null ? undefined : (
          <>
            {retest}
            <AppText variant="caption" tone="textDim" style={styles.centered}>
              {t('phoneRating.tip')}
            </AppText>
          </>
        )
      }
    >
      {rating === null ? (
        <Card>
          <AppText variant="headline" style={styles.centered}>
            {t('phoneRating.notTested')}
          </AppText>
          <AppText tone="textDim" style={styles.centered}>
            {t('phoneRating.notTestedBody')}
          </AppText>
          {retest}
        </Card>
      ) : (
        <>
          <RatingGauge
            score={rating.score}
            label={String(rating.score)}
            caption={tierLabel(t, rating.tier)}
          />
          <AppText tone="textDim" style={styles.centered}>
            {t('phoneRating.tested', {
              date: new Date(rating.testedAt).toLocaleDateString(i18n.language, {
                month: 'short',
                day: 'numeric',
              }),
            })}
          </AppText>
        </>
      )}
      <SectionLabel>{t('phoneRating.measures')}</SectionLabel>
      <Card flush>
        {lines.map(({ icon, name, max, points, detail }, index) => (
          <View
            key={name}
            style={{
              gap: spacing.sm,
              padding: spacing.md,
              borderBottomColor: colors.line,
              borderBottomWidth: index === lines.length - 1 ? 0 : StyleSheet.hairlineWidth,
            }}
          >
            <View style={[styles.line, { gap: spacing.md }]}>
              <View style={[styles.tile, { backgroundColor: colors.surface2, borderRadius: radius.card / 2 }]}>
                {icon === null ? null : <Icon name={icon} size={20} color={colors.textDim} />}
              </View>
              <AppText style={styles.name}>{name}</AppText>
              <AppText variant="headline" tone="textDim">
                {points === null ? t('phoneRating.points', { max }) : t('phoneRating.score', { points, max })}
              </AppText>
            </View>
            {points === null ? null : (
              <View
                testID="rating-bar"
                style={[styles.track, { backgroundColor: colors.surface3, borderRadius: radius.pill }]}
              >
                <View
                  style={[
                    styles.track,
                    {
                      width: `${(points / max) * 100}%`,
                      backgroundColor: colors.accentFill,
                      borderRadius: radius.pill,
                    },
                  ]}
                />
              </View>
            )}
            {detail === null ? null : (
              <AppText variant="caption" tone="textDim">
                {detail}
              </AppText>
            )}
          </View>
        ))}
      </Card>
      {rating === null ? (
        <View
          style={[
            styles.line,
            styles.callout,
            { backgroundColor: colors.surface2, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
          ]}
        >
          <Icon name="hint" size={20} color={colors.accent} />
          <AppText tone="textDim" style={styles.name}>
            {t('phoneRating.tip')}
          </AppText>
        </View>
      ) : null}
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  centered: { textAlign: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  callout: { justifyContent: 'flex-start' },
  name: { flex: 1 },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6 },
});

import type { RatingMode } from '@lumen/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { formatNumber } from '@/i18n/formatNumber';
import { ratingModeLabel, tierLabel } from '@/rating/labels';
import { type DialSegment, PhoneScoreDial } from '@/settings/PhoneScoreDial';
import type { StoredRating } from '@/store/deviceRating';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

// Point values of the four rating components (spec 5.1).
const MAX_FRAME_RATE = 30;
const MAX_COUPLING = 35;
const MAX_LOCKS = 15;
const MAX_TIMING = 20;

// The checks a rating can open or keep closed, in the order the board lists them.
const SHOWN_MODES: readonly { mode: RatingMode; icon: IconName }[] = [
  { mode: 'quickCheck', icon: 'pulse' },
  { mode: 'fullScan', icon: 'bars' },
  { mode: 'rhythmFlags', icon: 'rhythm' },
  { mode: 'hrv', icon: 'clock' },
  { mode: 'deepHrv', icon: 'bars' },
  { mode: 'breathing', icon: 'breath' },
  { mode: 'standingTest', icon: 'standing' },
  { mode: 'pulseShape', icon: 'trends' },
  { mode: 'diabetes', icon: 'drop' },
  { mode: 'extraBeats', icon: 'extraBeat' },
];

type ComponentKey = 'ratingCamera' | 'ratingFlash' | 'ratingLocks' | 'ratingTiming';

type ComponentLine = {
  icon: IconName;
  color: ComponentKey;
  name: string;
  shortName: string;
  max: number;
  points: number | null;
  detail: string | null;
  // Set on the lock line: which of the three locks the phone holds, shown only when all are held.
  allHeld?: boolean;
};

function componentLines(rating: StoredRating | null, t: TFunction, language: string): ComponentLine[] {
  const { components, fpsLevel, practice } = rating ?? {};
  const pi = practice?.perfusionIndexPct;
  const jitter = practice?.frameIntervalSdMs;
  return [
    {
      icon: 'lens',
      color: 'ratingCamera',
      name: t('phoneRating.frameRate'),
      shortName: t('phoneRating.chipCamera'),
      max: MAX_FRAME_RATE,
      points: components?.frameRate ?? null,
      detail:
        fpsLevel === undefined || fpsLevel === null ? null : t('phoneRating.fpsDetail', { fps: fpsLevel }),
    },
    {
      icon: 'warm',
      color: 'ratingFlash',
      name: t('phoneRating.coupling'),
      shortName: t('phoneRating.chipFlash'),
      max: MAX_COUPLING,
      points: components?.coupling ?? null,
      detail:
        rating === null
          ? null
          : pi == null
            ? t('phoneRating.notMeasured')
            : t('phoneRating.couplingDetail', { pi: formatNumber(pi, language, 1, 1) }),
    },
    {
      icon: 'lock',
      color: 'ratingLocks',
      name: t('phoneRating.lock'),
      shortName: t('phoneRating.chipLocks'),
      max: MAX_LOCKS,
      points: components?.locks ?? null,
      detail: null,
      allHeld: components?.locks === MAX_LOCKS,
    },
    {
      icon: 'clock',
      color: 'ratingTiming',
      name: t('phoneRating.timing'),
      shortName: t('phoneRating.chipTiming'),
      max: MAX_TIMING,
      points: components?.timing ?? null,
      detail:
        rating === null
          ? null
          : jitter == null
            ? t('phoneRating.notMeasured')
            : t('phoneRating.timingDetail', { ms: formatNumber(jitter, language, 1, 1) }),
    },
  ];
}

function ScoreCard({ rating, lines }: { rating: StoredRating; lines: readonly ComponentLine[] }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const segments: DialSegment[] = lines.map(({ max, points, color }) => ({
    max,
    points,
    color: colors[color],
  }));
  const tier = tierLabel(t, rating.tier);
  const testedDate = new Date(rating.testedAt).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <PhoneScoreDial
          segments={segments}
          label={String(rating.score)}
          tier={tier}
          testedLine={t('phoneRating.tested', { date: testedDate })}
          summary={`${rating.score}, ${tier}`}
        />
        <View style={{ flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: spacing.sm }}>
          {lines.map(({ color, shortName, points }) => (
            <View
              key={shortName}
              style={{
                flex: 1,
                minWidth: 0,
                paddingVertical: spacing.sm,
                paddingHorizontal: 6,
                borderRadius: 14,
                backgroundColor: colors.bg,
                alignItems: 'center',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[color] }} />
                <AppText variant="caption1" tone="textDim" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {shortName}
                </AppText>
              </View>
              <AppText variant="title3" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {points === null ? t('phoneRating.noScore') : points}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

function MeasureLines({ lines }: { lines: readonly ComponentLine[] }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const lockNames = [
    t('phoneRating.lockExposure'),
    t('phoneRating.lockWhiteBalance'),
    t('phoneRating.lockFocus'),
  ];
  return (
    <Card flush>
      <AppText
        variant="caption"
        tone="textDim"
        accessibilityRole="header"
        style={{ fontWeight: '600', paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 2 }}
      >
        {t('phoneRating.measures')}
      </AppText>
      {lines.map(({ icon, color, name, max, points, detail, allHeld }, index) => (
        <View
          key={name}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.md,
            paddingVertical: 14,
            paddingHorizontal: spacing.lg,
            borderBottomColor: colors.line,
            borderBottomWidth: index === lines.length - 1 ? 0 : StyleSheet.hairlineWidth,
          }}
        >
          <View style={[styles.tile, { backgroundColor: colors[color] }]}>
            <Icon name={icon} size={20} color={colors.onButtonFill} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
              <AppText style={{ flexShrink: 1 }}>{name}</AppText>
              <AppText style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {points === null ? t('phoneRating.noScore') : points}
                <AppText tone="textDim" style={{ fontWeight: '500' }}>
                  {`/${max}`}
                </AppText>
              </AppText>
            </View>
            {points === null ? null : (
              <View
                testID="rating-bar"
                accessibilityLabel={t('phoneRating.barLabel', { name, points, max })}
                style={[styles.track, { backgroundColor: colors.surface3, borderRadius: radius.pill }]}
              >
                <View
                  style={[
                    styles.track,
                    {
                      width: `${(points / max) * 100}%`,
                      backgroundColor: colors[color],
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
            {allHeld ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {lockNames.map((lock) => (
                  <View
                    key={lock}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.xs,
                      height: 22,
                      paddingHorizontal: 7,
                      borderRadius: 11,
                      backgroundColor: colors.bg,
                    }}
                  >
                    <Icon name="check" size={11} color={colors.accent} />
                    <AppText variant="caption1" style={{ fontWeight: '600' }}>
                      {lock}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

function UnlockCard({ rating }: { rating: StoredRating }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const open = SHOWN_MODES.filter(({ mode }) => rating.unlocks.includes(mode));
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <AppText
          variant="caption"
          tone="textDim"
          accessibilityRole="header"
          style={{ fontWeight: '600', flexShrink: 1 }}
        >
          {t('phoneRating.unlocks')}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Icon name="check" size={12} color={colors.accent} />
          <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
            {t('phoneRating.unlockedCount', { count: open.length })}
          </AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
        {SHOWN_MODES.map(({ mode, icon }) => {
          const unlocked = rating.unlocks.includes(mode);
          const name = ratingModeLabel(t, mode);
          return (
            <View
              key={mode}
              accessible
              accessibilityLabel={unlocked ? name : `${name}, ${t('phoneRating.locked')}`}
              style={{
                flexBasis: '47%',
                flexGrow: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 16,
                backgroundColor: unlocked ? colors.accentTint : colors.bg,
              }}
            >
              <View
                style={[styles.chipTile, { backgroundColor: unlocked ? colors.buttonFill : colors.surface3 }]}
              >
                <Icon
                  name={unlocked ? icon : 'lock'}
                  size={16}
                  color={unlocked ? colors.onButtonFill : colors.textFaint}
                />
              </View>
              <AppText
                variant="caption"
                tone={unlocked ? 'text' : 'textDim'}
                style={{ flex: 1, minWidth: 0, fontWeight: '600' }}
              >
                {name}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function TipCard() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={[styles.tile, { backgroundColor: colors.flag }]}>
          <Icon name="hint" size={20} color={colors.flagBg} />
        </View>
        <AppText variant="subheadline" tone="textDim" style={{ flex: 1 }}>
          {t('phoneRating.tip')}
        </AppText>
      </View>
    </Card>
  );
}

export default function PhoneRatingScreen() {
  const { t, i18n } = useTranslation();
  const { colors, radius } = useTheme();
  const rating = useStoredRating() ?? null;
  const lines = componentLines(rating, t, i18n.language);
  const retest = <NavButton label={t('phoneRating.retest')} href="/phone-check" />;
  return (
    <RouteShell title={t('phoneRating.title')} footer={rating === null ? undefined : retest}>
      {rating === null ? (
        <Card>
          <View
            testID="not-tested-tile"
            style={[
              styles.notTestedTile,
              { backgroundColor: colors.accentTint, borderRadius: radius.card / 2 },
            ]}
          >
            <Icon name="phone" size={22} color={colors.accent} />
          </View>
          <AppText variant="headline" style={styles.centered}>
            {t('phoneRating.notTested')}
          </AppText>
          <AppText tone="textDim" style={styles.centered}>
            {t('phoneRating.notTestedBody')}
          </AppText>
          {retest}
        </Card>
      ) : (
        <ScoreCard rating={rating} lines={lines} />
      )}
      <MeasureLines lines={lines} />
      {rating === null ? null : <UnlockCard rating={rating} />}
      <TipCard />
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  centered: { textAlign: 'center' },
  notTestedTile: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipTile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6 },
});

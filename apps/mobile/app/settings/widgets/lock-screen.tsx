import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import { LumenMark } from '@/settings/LumenMark';
import { LockCirclePreview, LockRectanglePreview } from '@/settings/WidgetPreviews';
import { useTheme } from '@/theme';
import tokens from '@/theme/tokens.json';

// Sample timer values for the preview; the real Live Activity counts down from the standing test.
const SAMPLE_STEP = 3;
const SAMPLE_STEPS = 5;
const SAMPLE_COUNTDOWN = '1:42';
const SAMPLE_PROGRESS = 0.6;
const BAR_HEIGHT = 4;

// A lock screen looks the same in either app theme (Widgets mockup, "Lock Screen"): a dark wallpaper, the dark
// see-through Live Activity card, and a light notification card.
const wallpaper = tokens.dark;
const notificationCard = tokens.light;

export default function LockScreenPreviewScreen() {
  const { t, i18n } = useTranslation();
  const { spacing, radius } = useTheme();
  const lockText = lockscreenStrings(i18n.language);
  const upToDate = lockTextLines(lockText['widget.lock.upToDate']);
  const inline = lockText['widget.lock.nextCheck'].replace('{{time}}', t('widgets.sampleTime'));
  // The big timer on the right is the countdown, so only the words before it are shown here.
  const nextReading = lockText['live.standing.next'].replace('{{countdown}}', '').trim();
  return (
    <RouteShell title={t('lockScreen.title')}>
      <AppText variant="caption" tone="textDim">
        {t('lockScreen.sample')}
      </AppText>
      <View
        style={{
          backgroundColor: wallpaper.surface3,
          borderRadius: radius.sheet,
          padding: spacing.lg,
          gap: spacing.xl,
        }}
      >
        <View style={[styles.centered, styles.center, { gap: spacing.xs }]}>
          <LumenMark size={14} color={wallpaper.text} />
          <AppText variant="subheadline" style={[styles.strong, { color: wallpaper.text }]}>
            {inline}
          </AppText>
        </View>
        <View style={[styles.centered, { gap: spacing.lg }]}>
          <LockCirclePreview />
          <LockRectanglePreview name={upToDate.name} status={upToDate.status} />
        </View>
        <View
          accessible
          accessibilityLabel={t('lockScreen.timer')}
          style={{
            backgroundColor: wallpaper.surface,
            borderRadius: radius.sheet - 2,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={[styles.centered, { gap: spacing.xs }]}>
            <LumenMark size={20} color={wallpaper.accent} />
            <AppText variant="headline" style={[styles.grow, { color: wallpaper.text }]}>
              {lockText['live.standing.title']}
            </AppText>
            <AppText variant="subheadline" style={{ color: wallpaper.textDim }}>
              {t('lockScreen.step', { step: SAMPLE_STEP, total: SAMPLE_STEPS })}
            </AppText>
          </View>
          <View style={styles.spread}>
            <AppText variant="subheadline" style={{ color: wallpaper.text }}>
              {nextReading}
            </AppText>
            <AppText variant="vitalM" style={{ color: wallpaper.accent }}>
              {SAMPLE_COUNTDOWN}
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: wallpaper.surface3 }]}>
            <View
              style={{
                width: `${SAMPLE_PROGRESS * 100}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: wallpaper.accent,
              }}
            />
          </View>
          <AppText variant="caption" style={{ color: wallpaper.textDim }}>
            {lockText['live.standing.tap']}
          </AppText>
        </View>
        <View
          accessible
          accessibilityLabel={t('lockScreen.reminder')}
          style={[
            styles.centered,
            {
              backgroundColor: notificationCard.surface,
              borderRadius: radius.sheet - 2,
              padding: spacing.md,
              gap: spacing.md,
            },
          ]}
        >
          <View style={[styles.appIcon, { backgroundColor: notificationCard.accentTint }]}>
            <LumenMark size={28} color={notificationCard.accent} />
          </View>
          <View style={styles.grow}>
            <View style={styles.spread}>
              <AppText variant="subheadline" style={[styles.strong, { color: notificationCard.text }]}>
                {t('app.name')}
              </AppText>
              <AppText variant="caption" style={{ color: notificationCard.textDim }}>
                {t('lockScreen.now')}
              </AppText>
            </View>
            <AppText variant="subheadline" style={{ color: notificationCard.text }}>
              {lockText['notif.confirm']}
            </AppText>
          </View>
        </View>
      </View>
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  centered: { flexDirection: 'row', alignItems: 'center' },
  center: { justifyContent: 'center' },
  grow: { flex: 1 },
  strong: { fontWeight: '600' },
  track: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
  appIcon: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});

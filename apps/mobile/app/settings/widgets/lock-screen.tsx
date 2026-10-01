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

// A lock screen looks the same in either app theme, so these cards use fixed token sets.
const wallpaper = tokens.dark;
const notificationCard = tokens.light;

export default function LockScreenPreviewScreen() {
  const { t, i18n } = useTranslation();
  const { spacing, radius } = useTheme();
  const lockText = lockscreenStrings(i18n.language);
  const upToDate = lockTextLines(lockText['widget.lock.upToDate']);
  // The big timer on the right is the countdown, so only the words before it are shown here.
  const nextReading = lockText['live.standing.next'].replace('{{countdown}}', '').trim();
  return (
    <RouteShell title={t('lockScreen.title')}>
      <AppText variant="caption" tone="textDim">
        {t('lockScreen.sample')}
      </AppText>
      <View
        style={{
          backgroundColor: wallpaper.surface2,
          borderRadius: radius.sheet,
          padding: spacing.lg,
          gap: spacing.lg,
        }}
      >
        <View style={[styles.widgets, { gap: spacing.md }]}>
          <LockCirclePreview scheme="dark" />
          <LockRectanglePreview name={upToDate.name} status={upToDate.status} scheme="dark" />
        </View>
        <View
          accessible
          accessibilityLabel={t('lockScreen.timer')}
          style={{
            backgroundColor: wallpaper.bg,
            borderRadius: radius.sheet,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <View style={styles.spread}>
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <LumenMark size={30} color={wallpaper.accentFill} />
              <AppText variant="headline" style={{ color: wallpaper.text }}>
                {lockText['live.standing.title']}
              </AppText>
            </View>
            <AppText variant="caption" style={{ color: wallpaper.textDim }}>
              {t('lockScreen.step', { step: SAMPLE_STEP, total: SAMPLE_STEPS })}
            </AppText>
          </View>
          <View style={styles.spread}>
            <AppText style={{ color: wallpaper.text }}>{nextReading}</AppText>
            <AppText variant="display" style={{ color: wallpaper.accent }}>
              {SAMPLE_COUNTDOWN}
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: wallpaper.surface3 }]}>
            <View
              style={{
                width: `${SAMPLE_PROGRESS * 100}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: wallpaper.accentFill,
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
          style={{
            backgroundColor: notificationCard.surface3,
            borderRadius: radius.card,
            padding: spacing.lg,
            gap: spacing.xs,
          }}
        >
          <View style={styles.spread}>
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <LumenMark size={26} color={notificationCard.accent} />
              <AppText variant="caption" style={{ color: notificationCard.text, fontWeight: '700' }}>
                {t('app.name').toUpperCase()}
              </AppText>
            </View>
            <AppText variant="caption" style={{ color: notificationCard.textDim }}>
              {t('lockScreen.now')}
            </AppText>
          </View>
          <AppText style={{ color: notificationCard.text }}>{lockText['notif.confirm']}</AppText>
        </View>
      </View>
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  widgets: { flexDirection: 'row', justifyContent: 'center' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  centered: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
});

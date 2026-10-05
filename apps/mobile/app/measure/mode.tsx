import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { lockText } from '@/checks/lockText';
import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { RouteShell } from '@/components/RouteShell';
import { durationLabel } from '@/measure/durationLabel';
import { MODES } from '@/measure/mode';
import { ModeCard } from '@/measure/ModeCard';
import { tierLabel } from '@/rating/labels';
import { lockReason } from '@/rating/modeLock';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

export default function ModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rating = useStoredRating();
  const { colors, spacing, control } = useTheme();
  // The rating's reason (spec §5.3) when this phone's tier leaves the mode locked; otherwise nothing.
  const lock = (mode: keyof typeof MODES) => {
    const reason = lockReason(rating, mode);
    if (reason === null) return {};
    return { unavailable: lockText(t, reason), locked: true };
  };
  const anyLocked = (Object.keys(MODES) as (keyof typeof MODES)[]).some(
    (mode) => lockReason(rating, mode) !== null,
  );
  return (
    <RouteShell title={t('mode.title')}>
      {/* Opened from a notification or link there is no screen behind this one, so the native back button is
          missing; the chevron then goes Home. */}
      {router.canGoBack() ? null : (
        <Stack.Screen
          options={{
            headerLeft: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                hitSlop={spacing.md}
                onPress={() => router.replace('/')}
                style={{
                  minWidth: control.minTarget,
                  minHeight: control.minTarget,
                  justifyContent: 'center',
                }}
              >
                <Icon name="back" size={control.chevronSize + 4} color={colors.accent} />
              </Pressable>
            ),
          }}
        />
      )}
      <ModeCard
        title={t('mode.full')}
        body={t('mode.fullBody')}
        duration={durationLabel(t, MODES.full.duration)}
        recommended={t('mode.recommended')}
        onPress={() => router.push('/measure/precheck?mode=full')}
        {...lock('full')}
      />
      <ModeCard
        title={t('mode.quick')}
        body={t('mode.quickBody')}
        duration={durationLabel(t, MODES.quick.duration)}
        onPress={() => router.push('/measure/precheck?mode=quick')}
        {...lock('quick')}
      />
      <ModeCard
        title={t('mode.deep')}
        body={t('mode.deepBody')}
        duration={durationLabel(t, MODES.deep.duration)}
        unavailable={t('mode.deepSoon')}
        {...lock('deep')}
      />
      <ModeCard
        title={t('mode.standing')}
        body={t('mode.standingBody')}
        duration={durationLabel(t, MODES.standing.duration)}
        onPress={() => router.push('/measure/standing-test')}
        {...lock('standing')}
      />
      {rating ? (
        <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
          {t(anyLocked ? 'mode.footerLocked' : 'mode.footerOpen', {
            phone: t('mode.thisPhone'),
            tier: tierLabel(t, rating.tier),
          })}
        </AppText>
      ) : null}
    </RouteShell>
  );
}

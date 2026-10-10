import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { lockText } from '@/checks/lockText';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { RouteShell } from '@/components/RouteShell';
import { durationLabel } from '@/measure/durationLabel';
import { MODES } from '@/measure/mode';
import { ModeCard } from '@/measure/ModeCard';
import { tierLabel } from '@/rating/labels';
import { lockReason } from '@/rating/modeLock';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

type ListedMode = {
  mode: keyof typeof MODES;
  icon: IconName;
  name: string;
  body: string;
  unavailable?: string;
  locked?: boolean;
};

export default function ModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rating = useStoredRating();
  const [picked, setPicked] = useState<keyof typeof MODES>('full');
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
  const listed: readonly ListedMode[] = [
    { mode: 'full', icon: 'pulse', name: t('mode.full'), body: t('mode.fullBody'), ...lock('full') },
    { mode: 'quick', icon: 'heart', name: t('mode.quick'), body: t('mode.quickBody'), ...lock('quick') },
    {
      mode: 'standing',
      icon: 'standing',
      name: t('mode.standing'),
      body: t('mode.standingBody'),
      ...lock('standing'),
    },
    {
      mode: 'deep',
      icon: 'trends',
      name: t('mode.deep'),
      body: t('mode.deepBody'),
      unavailable: t('mode.deepSoon'),
      ...lock('deep'),
    },
  ];
  // Full Scan is preselected unless this phone's rating locks it; then the first mode that can start is.
  const chosen =
    listed.find((entry) => entry.mode === picked && !entry.unavailable) ??
    listed.find((entry) => !entry.unavailable);
  const startChosen = () => {
    if (!chosen) return;
    router.push(
      chosen.mode === 'standing' ? '/measure/standing-test' : `/measure/precheck?mode=${chosen.mode}`,
    );
  };
  return (
    <RouteShell
      title={t('mode.title')}
      footer={
        <Button
          label={t('mode.continueWith', { mode: chosen?.name ?? t('mode.title') })}
          disabled={!chosen}
          onPress={startChosen}
        />
      }
    >
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
      <Card flush>
        {listed.map(({ mode, icon, name, body, unavailable, locked }, index) => (
          <ModeCard
            key={mode}
            icon={icon}
            title={name}
            body={body}
            duration={durationLabel(t, MODES[mode].duration)}
            recommended={mode === 'full' ? t('mode.recommended') : undefined}
            selected={chosen?.mode === mode}
            unavailable={unavailable}
            locked={locked}
            last={index === listed.length - 1}
            onSelect={() => setPicked(mode)}
          />
        ))}
      </Card>
      {rating ? (
        <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
          {anyLocked
            ? t('mode.footerLocked', { phone: t('mode.thisPhone'), tier: tierLabel(t, rating.tier) })
            : t('mode.footerOpen', { phone: t('mode.thisPhone'), tier: tierLabel(t, rating.tier) })}
        </AppText>
      ) : null}
    </RouteShell>
  );
}

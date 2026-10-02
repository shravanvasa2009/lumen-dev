import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { FingerPreview, ProgressRing } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

import { LiveWaveform } from './LiveWaveform';
import { coachingText } from './coachingText';
import { cleanSecondsNeeded, type MeasureMode } from './mode';
import { phaseCaption } from './phaseCaption';
import type { LiveCapture } from './useLiveCapture';

const RING_SIZE = 150;
const RING_STROKE = 10;
const NO_VALUE = '—';

type CaptureViewProps = {
  mode: MeasureMode;
  live: LiveCapture;
  onCancel: () => void;
  onStop: () => void;
};

export function CaptureView({ mode, live, onCancel, onStop }: CaptureViewProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const total = cleanSecondsNeeded(mode);
  const running = live.phase === 'running';
  const counting = running && live.cleanSeconds !== null;
  const coaching = counting ? live.coachingKey : null;
  const paused = coaching !== null;
  const fingerOn = live.status?.fingerCovered === true;
  const done = live.cleanSeconds === null ? null : Math.min(total, Math.floor(live.cleanSeconds));
  const caption =
    phaseCaption(t, live) ??
    (counting
      ? t('capture.timerNote')
      : `${t('capture.cameraOn', { seconds: Math.floor(live.elapsedS) })} ${t('capture.waiting')}.`);

  return (
    <Screen headerless footer={<Button variant="secondary" label={t('capture.stop')} onPress={onStop} />}>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('capture.cancel')}
            onPress={onCancel}
            style={{ minWidth: control.minTarget, minHeight: control.minTarget, justifyContent: 'center' }}
          >
            <Icon name="close" size={24} color={colors.textDim} />
          </Pressable>
          <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {mode === 'quick' ? t('mode.quick') : t('mode.full')}
          </AppText>
        </View>

        <View style={{ alignItems: 'center', gap: spacing.md }}>
          {live.status ? (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
                backgroundColor: fingerOn ? colors.badgeCheckedBg : colors.surface3,
              }}
            >
              <AppText
                variant="caption"
                style={{ fontWeight: '600', color: fingerOn ? colors.badgeCheckedFg : colors.text }}
              >
                {fingerOn ? t('capture.fingerDetected') : t('capture.fingerMissing')}
              </AppText>
            </View>
          ) : null}
          <FingerPreview detected={fingerOn} />
          {fingerOn ? null : (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('placement.flashOutsideBump')}
            </AppText>
          )}
        </View>

        {coaching ? (
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: radius.card,
              backgroundColor: colors.flagBg,
            }}
          >
            <Icon name="warning" size={22} color={colors.flag} />
            <AppText variant="headline" style={{ flex: 1, color: colors.flag }}>
              {coachingText(t)[coaching]}
            </AppText>
          </View>
        ) : counting ? (
          <AppText variant="headline" tone="accent" style={{ textAlign: 'center' }}>
            {t('capture.good')}
          </AppText>
        ) : null}

        <View
          accessible
          accessibilityLabel={`${done ?? NO_VALUE} ${t('capture.cleanOf', { total })}`}
          style={{ alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}
        >
          <ProgressRing
            fraction={done === null ? 0 : done / total}
            size={RING_SIZE}
            strokeWidth={RING_STROKE}
            paused={paused}
          />
          <View style={{ position: 'absolute', alignItems: 'center' }}>
            <AppText variant="display">{done ?? NO_VALUE}</AppText>
            <AppText variant="caption" tone="textDim">
              {paused ? t('capture.pausedOf', { total }) : t('capture.cleanOf', { total })}
            </AppText>
          </View>
        </View>
        <AppText tone="textDim" style={{ textAlign: 'center' }}>
          {caption}
        </AppText>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText tone="textDim">{t('capture.pulse')}</AppText>
            <AppText tone="textDim">{t('capture.last6s')}</AppText>
          </View>
          <LiveWaveform red={live.recentRed} />
          {running ? null : (
            <AppText variant="caption" tone="textDim">
              {t('capture.noWaveform')}
            </AppText>
          )}
        </Card>

        {live.status ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
            <CheckLabel label={t('capture.finger')} passing={fingerOn} />
            {counting ? (
              <>
                <CheckLabel label={t('capture.still')} passing={coaching !== 'coach.still'} />
                <CheckLabel label={t('capture.pressure')} passing={coaching !== 'coach.lighter'} />
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function CheckLabel({ label, passing }: { label: string; passing: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Icon name={passing ? 'check' : 'warning'} size={18} color={passing ? colors.accent : colors.flag} />
      <AppText tone="textDim">{label}</AppText>
    </View>
  );
}

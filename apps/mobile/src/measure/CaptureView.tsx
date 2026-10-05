import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { PlanPhone } from '@/checks/checkPlan';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { FingerPreview, ProgressRing } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';
import { StillMotion } from '@/theme/motion';

import { CameraDeniedNotice } from './CameraDeniedNotice';
import { CheckingRow, COMPACT_WIDTH_DP } from './CheckingRow';
import { TipsSheet } from './TipsSheet';
import { checkingItems } from './checkingItems';
import { captureSizes } from './captureLayout';
import { LiveWaveform } from './LiveWaveform';
import { coachingText } from './coachingText';
import { captureVerdict } from './captureVerdict';
import { cleanSecondsNeeded, type MeasureMode } from './mode';
import { phaseCaption } from './phaseCaption';
import { QualityChip } from './QualityChip';
import type { LiveCapture } from './useLiveCapture';

const RING_STROKE = 10;
const TIGHT_RING_STROKE = 8;
const NO_VALUE = '—';

type CaptureViewProps = {
  mode: MeasureMode;
  live: LiveCapture;
  phone: PlanPhone;
  onCancel: () => void;
  onStop: () => void;
};

export function CaptureView({ mode, live, phone, onCancel, onStop }: CaptureViewProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [tipsOpen, setTipsOpen] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [chipWidth, setChipWidth] = useState(0);
  const { width } = useWindowDimensions();
  const sizes = captureSizes(viewport, width < COMPACT_WIDTH_DP);
  const { tight } = sizes;
  const rowGap = tight ? spacing.sm : spacing.md;
  const total = cleanSecondsNeeded(mode);
  const running = live.phase === 'running';
  const counting = running && live.cleanSeconds !== null;
  const { level, coaching: stoppedFor } = captureVerdict(live);
  const coaching = counting ? stoppedFor : null;
  const paused = coaching !== null;
  const fingerOn = live.status?.fingerCovered === true;
  const done = live.cleanSeconds === null ? null : Math.min(total, Math.floor(live.cleanSeconds));
  const caption =
    phaseCaption(t, live) ??
    (counting
      ? t('capture.timerNote')
      : `${t('capture.cameraOn', { seconds: Math.floor(live.elapsedS) })} ${t('capture.waiting')}.`);

  return (
    <StillMotion.Provider value>
      <Screen headerless footer={<Button variant="secondary" label={t('capture.stop')} onPress={onStop} />}>
        <ScrollView
          onLayout={(event) => setViewport(Math.floor(event.nativeEvent.layout.height))}
          contentContainerStyle={{ gap: rowGap, paddingBottom: spacing.sm }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: Math.max(control.minTarget, chipWidth) }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('capture.cancel')}
                onPress={onCancel}
                style={{ width: control.minTarget, minHeight: control.minTarget, justifyContent: 'center' }}
              >
                <Icon name="close" size={24} color={colors.textDim} />
              </Pressable>
            </View>
            <AppText
              variant={width < COMPACT_WIDTH_DP ? 'headline' : 'title'}
              accessibilityRole="header"
              style={{ flex: 1, textAlign: 'center' }}
            >
              {mode === 'quick' ? t('mode.quick') : t('mode.full')}
            </AppText>
            <View style={{ minWidth: control.minTarget, alignItems: 'flex-end' }}>
              <QualityChip
                level={running ? (level ?? 0) : null}
                compact={width < COMPACT_WIDTH_DP}
                onLayout={(event) => setChipWidth(Math.ceil(event.nativeEvent.layout.width))}
              />
            </View>
          </View>
          <TipsSheet visible={tipsOpen} onDismiss={() => setTipsOpen(false)} />
          <CameraDeniedNotice live={live} centered />

          <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 26 }}>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('capture.tips')}
              hitSlop={control.minTarget / 4}
              onPress={() => setTipsOpen(true)}
              style={{ position: 'absolute', right: 0, paddingHorizontal: spacing.md }}
            >
              <AppText variant="headline" tone="textDim">
                ?
              </AppText>
            </Pressable>
          </View>
          <View style={{ alignItems: 'center' }}>
            <FingerPreview
              detected={fingerOn}
              size={sizes.preview}
              cameraRunning={live.nativeCamera && running}
              coaching={paused}
            />
          </View>
          <View
            accessible
            accessibilityLabel={`${done ?? NO_VALUE} ${t('capture.cleanOf', { total })}`}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}
          >
            <ProgressRing
              fraction={done === null ? 0 : done / total}
              size={sizes.ring}
              strokeWidth={tight ? TIGHT_RING_STROKE : RING_STROKE}
              paused={paused}
            />
            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <AppText variant="display">{done ?? NO_VALUE}</AppText>
              <AppText variant="caption" tone="textDim">
                {paused ? t('capture.pausedOf', { total }) : t('capture.cleanOf', { total })}
              </AppText>
            </View>
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
          ) : null}

          {live.phase === 'denied' || (tight && counting) ? null : (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {caption}
            </AppText>
          )}

          {fingerOn ? null : (
            <AppText tone="textDim" style={{ textAlign: 'center' }}>
              {t('placement.flashOutsideBump')}
            </AppText>
          )}

          <Card dense={tight}>
            <LiveWaveform
              pulse={live.recentPulse}
              red={live.recentRed}
              height={sizes.waveformHeight}
              withFact={!tight}
            />
            {running ? null : (
              <AppText variant="caption" tone="textDim">
                {t('capture.noWaveform')}
              </AppText>
            )}
          </Card>

          {live.status && !tight ? (
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

          <CheckingRow mode={mode} items={checkingItems(mode, live.cleanSeconds, phone)} dimmed={paused} />
        </ScrollView>
      </Screen>
    </StillMotion.Provider>
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

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { QualityReason } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { cleanSecondsNeeded } from '@/measure/mode';
import { useTheme } from '@/theme';

import type { FixtureReading } from './fixtures';
import { LowerQualitySheet } from './LowerQualityTag';

const RING = 64;
const RING_RADIUS = 27;
const RING_WIDTH = 7;

function ProgressRing({ share, value, caption }: { share: number; value: number; caption: string }) {
  const { colors, spacing } = useTheme();
  const circumference = 2 * Math.PI * RING_RADIUS;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${value} ${caption}`}
      style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.sm - 2 }}
    >
      <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={RING} height={RING} style={{ position: 'absolute' }}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={colors.surface3}
            strokeWidth={RING_WIDTH}
          />
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={colors.flag}
            strokeWidth={RING_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${circumference * Math.min(1, Math.max(0, share))} ${circumference}`}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </Svg>
        <AppText importantForAccessibility="no" style={{ fontSize: 20, lineHeight: 24, fontWeight: '700' }}>
          {String(value)}
        </AppText>
      </View>
      <AppText
        importantForAccessibility="no"
        variant="caption"
        tone="textDim"
        style={{ textAlign: 'center' }}
      >
        {caption}
      </AppText>
    </View>
  );
}

type SignalQualityCardProps = { reading: FixtureReading; reasons: readonly QualityReason[] };

// The lower-quality board's card: three small rings that show how much of the scan was usable. A ring appears
// only when the reading recorded that count, so nothing here is estimated.
export function SignalQualityCard({ reading, reasons }: SignalQualityCardProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const wantSeconds = cleanSecondsNeeded(reading.mode);
  const cleanSeconds = Math.min(wantSeconds, Math.floor(reading.scan.cleanSeconds));
  const flagged = reasons.find((reason) => reason.kind === 'sqiFlagged');
  const windows = reasons.find((reason) => reason.kind === 'fewWindows');
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.sheet, overflow: 'hidden' }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('quality.cardTitle')}
        accessibilityHint={t('quality.chipHint')}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.chip,
            backgroundColor: colors.flagBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="warning" size={18} color={colors.flag} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{t('quality.cardTitle')}</AppText>
          <AppText variant="subheadline" tone="textDim">
            {t('quality.cardSubtitle')}
          </AppText>
        </View>
        <Icon name="chevron" size={14} color={colors.glyph} />
      </PressableScale>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md + 2,
          paddingBottom: spacing.lg,
        }}
      >
        <ProgressRing
          share={cleanSeconds / wantSeconds}
          value={cleanSeconds}
          caption={t('quality.ringClean', { want: wantSeconds })}
        />
        {flagged?.kind === 'sqiFlagged' ? (
          <ProgressRing
            share={(flagged.total - flagged.windows) / flagged.total}
            value={flagged.total - flagged.windows}
            caption={t('quality.ringParts', { total: flagged.total })}
          />
        ) : null}
        {windows?.kind === 'fewWindows' ? (
          <ProgressRing
            share={windows.windows / windows.wantWindows}
            value={windows.windows}
            caption={t('quality.ringStretches', { want: windows.wantWindows })}
          />
        ) : null}
      </View>
      <LowerQualitySheet visible={open} reasons={reasons} onDismiss={() => setOpen(false)} />
    </View>
  );
}

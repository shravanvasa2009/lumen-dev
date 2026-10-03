import type { RatingMode, RatingTier } from '@lumen/core';
import type { TFunction } from 'i18next';

export function tierLabel(t: TFunction, tier: RatingTier): string {
  const labels: Record<RatingTier, string> = {
    full: t('tier.full'),
    basic: t('tier.basic'),
    limited: t('tier.limited'),
    unsupported: t('tier.unsupported'),
  };
  return labels[tier];
}

// The diabetes pattern check is named by what it looks at, never by the condition.
export function ratingModeLabel(t: TFunction, mode: RatingMode): string {
  const labels: Record<RatingMode, string> = {
    quickCheck: t('ratingMode.quickCheck'),
    rhythmFlags: t('ratingMode.rhythmFlags'),
    breathing: t('ratingMode.breathing'),
    standingTest: t('ratingMode.standingTest'),
    extraBeats: t('ratingMode.extraBeats'),
    hrv: t('ratingMode.hrv'),
    deepHrv: t('ratingMode.deepHrv'),
    pulseShape: t('ratingMode.pulseShape'),
    diabetes: t('ratingMode.pulsePattern'),
    fullScan: t('ratingMode.fullScan'),
  };
  return labels[mode];
}

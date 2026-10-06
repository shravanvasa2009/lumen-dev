import type { TFunction } from 'i18next';

import type { MetricQuality, QualityReason, ReadingQuality, ReadingResult } from '@lumen/core';

// Readings stored before the quality fields existed (ADR 0104) have none; they render as standard.
type StoredQuality = { quality?: MetricQuality; qualityReasons?: QualityReason['kind'][] };

export function readingQuality(scan: ReadingResult): ReadingQuality {
  return (scan.quality as ReadingQuality | undefined) ?? { level: 'standard', reasons: [] };
}

// The reasons behind one metric's tag; a low metric that names none shows all of the reading's reasons.
export function metricReasons(metric: object | null, quality: ReadingQuality): QualityReason[] | null {
  const fields = metric as StoredQuality | null;
  if (fields?.quality !== 'low') return null;
  const kinds = fields.qualityReasons ?? [];
  const own = quality.reasons.filter((reason) => kinds.includes(reason.kind));
  return own.length > 0 ? own : quality.reasons;
}

export function reasonText(t: TFunction, reason: QualityReason): string {
  switch (reason.kind) {
    case 'shortClean':
      return t('quality.shortClean', { have: Math.round(reason.haveS), want: Math.round(reason.wantS) });
    case 'lowFps':
      return t('quality.lowFps', { fps: Math.round(reason.fps), want: Math.round(reason.wantFps) });
    case 'noSqi':
      return t('quality.noSqi');
    case 'modelFallback':
      return t('quality.modelFallback');
    case 'quickMode':
      return t('quality.quickMode');
    case 'contact':
      return t('quality.contact', { pct: Math.round(reason.coveredPct) });
    case 'fewBeats':
      return t('quality.fewBeats', { beats: reason.beats, want: reason.wantBeats });
    case 'fewWindows':
      return t('quality.fewWindows', { windows: reason.windows, want: reason.wantWindows });
    case 'estimatesDisagree':
      return t('quality.estimatesDisagree');
    case 'phoneTier':
      return t('quality.phoneTier', { tier: t(`tier.${reason.tier}`), want: t(`tier.${reason.wantTier}`) });
  }
}

// Why a card is empty, when the reading itself says; null means it truly is the signal.
export function missingReasonText(t: TFunction, reasons: readonly QualityReason[]): string | null {
  const kinds = new Set(reasons.map((reason) => reason.kind));
  if (kinds.has('shortClean')) return t('quality.missingShort');
  if (kinds.has('fewBeats')) return t('quality.missingBeats');
  if (kinds.has('fewWindows')) return t('quality.missingWindows');
  return null;
}

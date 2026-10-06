import type { TFunction } from 'i18next';

import type { MetricQuality, QualityReason, ReadingQuality, ReadingResult, Tier } from '@lumen/core';

// Readings stored before the quality fields existed (ADR 0104) have none; they render as standard. qualityDetails
// came later than qualityReasons.
type StoredQuality = {
  quality?: MetricQuality;
  qualityReasons?: QualityReason['kind'][];
  qualityDetails?: QualityReason[];
};

// A value tagged lower quality (ADR 0104); every surface that shows one marks it.
export const isLowQuality = (metric: object | null | undefined): boolean =>
  (metric as StoredQuality | null | undefined)?.quality === 'low';

export function readingQuality(scan: ReadingResult): ReadingQuality {
  return (scan.quality as ReadingQuality | undefined) ?? { level: 'standard', reasons: [] };
}

// The reasons behind one metric's tag, with that metric's own floors. A reading saved before qualityDetails falls
// back to the reading's reasons of the same kinds, and a low metric that names none shows all of them.
export function metricReasons(metric: object | null, quality: ReadingQuality): QualityReason[] | null {
  const fields = metric as StoredQuality | null;
  if (fields?.quality !== 'low') return null;
  if (fields.qualityDetails && fields.qualityDetails.length > 0) return fields.qualityDetails;
  const kinds = fields.qualityReasons ?? [];
  const own = quality.reasons.filter((reason) => kinds.includes(reason.kind));
  return own.length > 0 ? own : quality.reasons;
}

// i18n:check reads only literal keys.
function tierWord(t: TFunction, tier: Tier): string {
  switch (tier) {
    case 'full':
      return t('tier.full');
    case 'basic':
      return t('tier.basic');
    case 'limited':
      return t('tier.limited');
  }
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
      return t('quality.phoneTier', { tier: tierWord(t, reason.tier), want: tierWord(t, reason.wantTier) });
    case 'rhythmUnjudged':
      return t('quality.rhythmUnjudged');
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

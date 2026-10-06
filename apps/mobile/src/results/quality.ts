import type { TFunction } from 'i18next';

import type { ReadingResult } from '@lumen/core';

// These types mirror @lumen/core's results.ts contract; switch the import once that lands.
export type QualityReason =
  | { kind: 'shortClean'; haveS: number; wantS: number }
  | { kind: 'lowFps'; fps: number; wantFps: number }
  | { kind: 'noSqi' }
  | { kind: 'modelFallback' }
  | { kind: 'quickMode' }
  | { kind: 'contact'; coveredPct: number }
  | { kind: 'fewBeats'; beats: number; wantBeats: number }
  | { kind: 'fewWindows'; windows: number; wantWindows: number };
export type MetricQuality = 'standard' | 'low';
export interface ReadingQuality {
  level: MetricQuality;
  reasons: QualityReason[];
}
export type QualityKind = QualityReason['kind'];

type QualityFields = { quality?: MetricQuality; qualityReasons?: QualityKind[] };

// Readings stored before the quality fields existed have none; they render as standard.
export function readingQuality(scan: ReadingResult): ReadingQuality {
  return (scan as { quality?: ReadingQuality }).quality ?? { level: 'standard', reasons: [] };
}

// The reasons behind one metric's tag; a low metric that names none shows all of the reading's reasons.
export function metricReasons(metric: object | null, quality: ReadingQuality): QualityReason[] | null {
  const fields = metric as QualityFields | null;
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

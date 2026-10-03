import { type RatingMeasures, rateDevice } from '@lumen/core';

import type { Capabilities } from '../../modules/lumen-capture/src';
import type { KeptCapture } from '@/measure/keptCapture';
import { resyncNotifications } from '@/settings/applyPrefs';
import {
  loadDeviceRating,
  saveDeviceRating,
  type PracticeSummary,
  type StoredRating,
} from '@/store/deviceRating';

import { practiceMeasures } from './practiceMeasures';

// ADR 0058 item 1: with no lens chosen and nothing measured, the rating is the phone check's capability points.
const PROBE_ONLY: RatingMeasures = {
  lensId: null,
  achievedFps: null,
  frameIntervalSdMs: null,
  coupling: null,
};

// Rates this phone from the probe and the practice capture, stores the result, and returns what is stored.
// Null when neither the probe alone nor the practice decides a tier: the coupling was not measured, so the
// score stays open (spec §5.1) and nothing is stored.
export async function ratePhone(
  capabilities: Capabilities,
  practice: KeptCapture | null,
  appVersion: string | null,
): Promise<StoredRating | null> {
  let rating = rateDevice(capabilities, PROBE_ONLY);
  let measured: { lensId: string | null; summary: PracticeSummary | null } = { lensId: null, summary: null };
  if (rating.tier === null) {
    if (practice === null) return null;
    const { measures, summary } = practiceMeasures(practice);
    if (measures.coupling === null) return null;
    rating = rateDevice(capabilities, measures);
    measured = { lensId: measures.lensId, summary };
  }
  await saveDeviceRating(rating, {
    testedAt: Date.now(),
    osVersion: capabilities.osVersion,
    appVersion,
    lensId: measured.lensId,
    practice: measured.summary,
  });
  resyncNotifications();
  return loadDeviceRating();
}

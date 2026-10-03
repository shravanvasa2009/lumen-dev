import { type DeviceRating, type RatingMode, type RatingTier, tierUnlocks } from '@lumen/core';

import { lumenDatabase } from './database';

// What the practice step measured, kept beside the components so Your phone can show where each came from.
export type PracticeSummary = {
  achievedFps: number | null;
  frameIntervalSdMs: number | null;
  perfusionIndexPct: number | null;
  snrDb: number | null;
};

export type RatingDetails = {
  testedAt: number;
  osVersion: string;
  appVersion: string | null;
  lensId: string | null;
  practice: PracticeSummary | null;
};

export type StoredRating = RatingDetails & {
  score: number;
  tier: RatingTier;
  components: DeviceRating['components'];
  fpsLevel: number | null;
  ambient: boolean;
  hardFail: DeviceRating['hardFail'];
  unlocks: readonly RatingMode[];
};

type RatingRow = {
  tested_at: number;
  os_version: string;
  app_version: string | null;
  score: number;
  tier: string;
  components_json: string;
  lens_id: string | null;
};

type ComponentsJson = Pick<DeviceRating, 'components' | 'fpsLevel' | 'ambient' | 'hardFail'> & {
  practice: PracticeSummary | null;
};

const TIERS: readonly RatingTier[] = ['full', 'basic', 'limited', 'unsupported'];

function tierOf(stored: string): RatingTier {
  const tier = TIERS.find((candidate) => candidate === stored);
  if (tier === undefined) throw new Error(`the stored rating has an unknown tier "${stored}"`);
  return tier;
}

// A rating with no tier (coupling not measured yet) is never stored: it would read as a result.
export async function saveDeviceRating(rating: DeviceRating, details: RatingDetails): Promise<void> {
  if (rating.tier === null) throw new Error('a rating without a tier cannot be stored');
  const { components, fpsLevel, ambient, hardFail } = rating;
  const componentsJson: ComponentsJson = {
    components,
    fpsLevel,
    ambient,
    hardFail,
    practice: details.practice,
  };
  const database = await lumenDatabase();
  await database.runAsync(
    'INSERT INTO device_rating (tested_at, os_version, app_version, score, tier, components_json, lens_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      details.testedAt,
      details.osVersion,
      details.appVersion,
      rating.score,
      rating.tier,
      JSON.stringify(componentsJson),
      details.lensId,
    ],
  );
}

// The newest rating, or null when this phone has not been rated.
export async function loadDeviceRating(): Promise<StoredRating | null> {
  const database = await lumenDatabase();
  const row = await database.getFirstAsync<RatingRow>(
    'SELECT tested_at, os_version, app_version, score, tier, components_json, lens_id FROM device_rating ORDER BY tested_at DESC, id DESC LIMIT 1',
  );
  if (row === null) return null;
  const { components, fpsLevel, ambient, hardFail, practice } = JSON.parse(
    row.components_json,
  ) as ComponentsJson;
  const tier = tierOf(row.tier);
  return {
    testedAt: row.tested_at,
    osVersion: row.os_version,
    appVersion: row.app_version,
    lensId: row.lens_id,
    practice,
    score: row.score,
    tier,
    components,
    fpsLevel,
    ambient,
    hardFail,
    unlocks: tierUnlocks(tier),
  };
}

// The tier a reading is judged under (ReadingContext.tier): null for an unrated phone, and for one the
// rating found unsupported, which takes no readings.
export async function storedReadingTier(): Promise<Exclude<RatingTier, 'unsupported'> | null> {
  const stored = await loadDeviceRating();
  return stored === null || stored.tier === 'unsupported' ? null : stored.tier;
}

import {
  type DeviceRating,
  type RatingCapabilities,
  type RatingMeasures,
  rateDevice,
  tierUnlocks,
} from '@lumen/core';
import { Platform } from 'react-native';

// SHOWCASE builds only (owner, 2026-10-25): the A17's setup film shows the 73 this phone earned in its real
// practices, whatever the replayed take scores. The parts add up as §5.1 scores them: 30 fps (14 of 30), coupling
// 32 of 35, all three locks (15), frame timing SD under 3 ms (12 of 20). 30 fps keeps it Basic (Full needs 60 fps),
// so the rating screen's locked checks give the real reason. The iPhone keeps its own computed rating.
const A17_FILM = { frameRate: 14, coupling: 32, locks: 15, timing: 12 };

export function showcaseRating(capabilities: RatingCapabilities, measures: RatingMeasures): DeviceRating {
  if (Platform.OS === 'ios') return rateDevice(capabilities, measures);
  let computed: string;
  try {
    const rating = rateDevice(capabilities, measures);
    computed = `${rating.score} (${rating.tier})`;
  } catch (error) {
    computed = `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.warn(`[showcase] rating ${computed} shown as 73 (basic)`);
  return {
    components: A17_FILM,
    score: A17_FILM.frameRate + A17_FILM.coupling + A17_FILM.locks + A17_FILM.timing,
    fpsLevel: 30,
    ambient: false,
    tier: 'basic',
    hardFail: null,
    unlocks: tierUnlocks('basic'),
  };
}

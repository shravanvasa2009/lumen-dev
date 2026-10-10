import { DSP_CONFIG } from '@lumen/core';

import type { StoredReading } from '@/home/readings';

import { isLowQuality } from './quality';

// personal: the person's own range from earlier readings. Otherwise it is the typical range for an adult at rest.
export type UsualBand = { low: number; high: number; personal: boolean };

// AHA: a normal resting heart rate for adults is 60 to 100 bpm. Shown only until there is a personal band.
const TYPICAL_RESTING_BPM: UsualBand = { low: 60, high: 100, personal: false };
// A typical adult breathes 12 to 20 times a minute at rest.
export const TYPICAL_BREATHING: UsualBand = { low: 12, high: 20, personal: false };

const MIN_HALF_WIDTH_BPM = 3;

function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below]! + (position - below) * (sorted[above]! - sorted[below]!);
}

// Same rule as the HRV band (spec 7): median plus or minus 1.5 IQR of earlier readings, once there are seven.
export function usualHeartRateBand(
  readings: readonly StoredReading[],
  current: { id: string; takenAt: number },
): UsualBand {
  const { personalBandMinReadings, personalBandIqrs } = DSP_CONFIG.rules;
  const earlier = readings
    .filter((reading) => reading.id !== current.id && reading.takenAt < current.takenAt)
    .flatMap((reading) => {
      const hr = reading.outcome.metrics.hr;
      return hr && !isLowQuality(hr) ? [hr.value] : [];
    })
    .sort((first, second) => first - second);
  if (earlier.length < personalBandMinReadings) return TYPICAL_RESTING_BPM;
  // At least 3 bpm each side: very steady readings would otherwise shade a band too thin to see.
  const spread = Math.max(
    MIN_HALF_WIDTH_BPM,
    personalBandIqrs * (quantile(earlier, 0.75) - quantile(earlier, 0.25)),
  );
  const middle = quantile(earlier, 0.5);
  return { low: Math.floor(middle - spread), high: Math.ceil(middle + spread), personal: true };
}

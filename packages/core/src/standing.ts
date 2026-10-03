import { DSP_CONFIG } from './config';

// §10 DSP-16 and the §10.1 "Large rise on standing" rule. Readings of the spec where it is silent are in
// ADR 0063. Rises are compared unrounded, as the §10.1 resting-rate rules compare HR.

export type StandingMinute = 1 | 3 | 5 | 10;

export interface StandingReading {
  minute: StandingMinute;
  bpm: number | null; // null: the reading was attempted but inconclusive
}

export interface StandingRise {
  thresholdBpm: number;
  rises: { minute: StandingMinute; riseBpm: number | null }[];
  flag: 'largeRise' | null;
  completed: boolean;
}

const isPositiveRate = (bpm: number) => Number.isFinite(bpm) && bpm > 0;

function riseThresholdBpm(ageYears: number): number {
  const { minAgeYears, adolescentMaxAgeYears, adolescentRiseBpm, adultRiseBpm } = DSP_CONFIG.dsp16;
  if (!Number.isInteger(ageYears)) throw new RangeError(`age ${ageYears} is not a whole number of years`);
  // The profile blocks these ages (§6.6), so reaching here is a caller bug, not a reading to judge.
  if (ageYears < minAgeYears) throw new RangeError(`age ${ageYears} is under ${minAgeYears}`);
  return ageYears <= adolescentMaxAgeYears ? adolescentRiseBpm : adultRiseBpm;
}

/** DSP-16: rise over the lying baseline per standing reading and the "large rise on standing" flag. */
export function standingRise(
  baselineBpm: number,
  standing: StandingReading[],
  ageYears: number,
  stoppedFaint: boolean,
): StandingRise {
  const { standingMinutes, consecutiveReadings } = DSP_CONFIG.dsp16;
  if (!isPositiveRate(baselineBpm)) throw new RangeError(`baseline ${baselineBpm} bpm is not a valid rate`);
  const thresholdBpm = riseThresholdBpm(ageYears);
  // Readings must be a prefix of the protocol: a skipped, repeated, or reordered slot is a caller bug.
  if (standing.length > standingMinutes.length)
    throw new RangeError(`${standing.length} standing readings; the protocol has ${standingMinutes.length}`);
  standing.forEach((reading, index) => {
    if (reading.minute !== standingMinutes[index])
      throw new RangeError(
        `standing reading ${index + 1} is at minute ${reading.minute}, not ${standingMinutes[index]}`,
      );
    if (reading.bpm !== null && !isPositiveRate(reading.bpm))
      throw new RangeError(`minute ${reading.minute} rate ${reading.bpm} bpm is not a valid rate`);
  });

  const rises = standing.map(({ minute, bpm }) => ({
    minute,
    riseBpm: bpm === null ? null : bpm - baselineBpm,
  }));
  // An inconclusive reading (null) resets the run: "two consecutive" read conservatively (ADR 0063).
  let run = 0;
  let pairMet = false;
  for (const { riseBpm } of rises) {
    run = riseBpm !== null && riseBpm >= thresholdBpm ? run + 1 : 0;
    if (run >= consecutiveReadings) pairMet = true;
  }
  // A faint stop completes the protocol and keeps a pair already met: fainting is itself the safety
  // concern, so the flag that led there must not vanish (ADR 0063). Abandoned tests never flag (§10.1).
  const completed = stoppedFaint || standing.length === standingMinutes.length;
  return { thresholdBpm, rises, flag: completed && pairMet ? 'largeRise' : null, completed };
}

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
  stoppedFaint: boolean; // §6: a faint tap is a symptom, so the UI opens the safety path even without a flag
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
  // Readings must be a prefix of the protocol: a skipped (array hole), repeated, or reordered slot is a caller
  // bug. Each field is read once into a plain copy, and only the validated copies are used, so a getter or
  // Proxy cannot pass validation with one value and feed the rule another.
  const count = standing.length;
  if (count > standingMinutes.length)
    throw new RangeError(`${count} standing readings; the protocol has ${standingMinutes.length}`);
  const copies: StandingReading[] = [];
  for (let index = 0; index < count; index++) {
    const reading: StandingReading | undefined = standing[index];
    if (reading === undefined || reading === null)
      throw new RangeError(`standing reading ${index + 1} is missing`);
    const { minute, bpm } = reading;
    if (minute !== standingMinutes[index])
      throw new RangeError(
        `standing reading ${index + 1} is at minute ${minute}, not ${standingMinutes[index]}`,
      );
    if (bpm !== null && !isPositiveRate(bpm))
      throw new RangeError(`minute ${minute} rate ${bpm} bpm is not a valid rate`);
    copies.push({ minute, bpm });
  }

  const rises = copies.map(({ minute, bpm }) => ({
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
  // §10.1 flags only a completed protocol. An "I feel faint" stop completes it, so a pair met before the stop
  // flags: owner decision H-043 B (ADR 0063 item 2). The UI routes stoppedFaint to the safety path whatever
  // the flag.
  const completed = stoppedFaint || count === standingMinutes.length;
  return { thresholdBpm, rises, flag: completed && pairMet ? 'largeRise' : null, completed, stoppedFaint };
}

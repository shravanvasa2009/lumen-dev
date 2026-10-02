import type { ReadingResult } from '@lumen/core';

import { latestReading, type StoredReading } from '@/home/readings';
import type { Appearance } from '@/theme/preferences';

// Spec §9.6: the four categories a widget may show. Null only before the first reading.
export type WidgetStatus = 'regular' | 'check-again' | 'see-doctor' | 'inconclusive';

// Appendix B widget snapshot. Times are UTC ISO strings so both widget platforms parse them the same way.
export type WidgetSnapshot = {
  v: 1;
  updatedAt: string;
  lastReadingAt: string | null;
  status: WidgetStatus | null;
  hrBpm: number | null;
  rhythmFlag: boolean;
  diabetesFlag: boolean;
  nextConfirmationAt: string | null;
  streakDays: number;
  hideValues: boolean;
  theme: Appearance;
};

type SnapshotInput = {
  readings: readonly StoredReading[];
  hideValues: boolean;
  theme: Appearance;
  // Owned by the notification plan, which decides when a confirmation reading is due.
  nextConfirmationAt: number | null;
  now: number;
};

// Appendix B writes times to the second; dropping the milliseconds keeps the snapshot well under 1 KB.
function isoSeconds(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Spec §12.5: a diabetes result below its evidence floor (ML-6 not met) is experimental and never reaches
// a widget, even if a flag were set on it.
function showsDiabetesFlag(outcome: ReadingResult): boolean {
  const diabetes = outcome.metrics.diabetes;
  return diabetes !== null && diabetes.flag !== null && diabetes.evidence !== 'experimental';
}

// See a doctor: the results that point to care (possible AFib, the "seek care" fast regular rhythm, the
// diabetes pattern's A1c advice; §6.2). Check again: the results that ask for a retake or a repeat
// (one irregular reading, a slow or fast resting rate, "Couldn't tell"). A seek-care result wins even when
// the rest of the reading was inconclusive.
function statusOf(outcome: ReadingResult): WidgetStatus {
  const { hr, rhythm } = outcome.metrics;
  if (rhythm?.flag === 'possibleAf' || hr?.flag === 'fastRegular' || showsDiabetesFlag(outcome)) {
    return 'see-doctor';
  }
  if (rhythm?.flag === 'irregular' || hr?.flag != null || outcome.headlineKey === 'result.uncertain') {
    return 'check-again';
  }
  if (outcome.headlineKey === 'result.inconclusive') return 'inconclusive';
  return 'regular';
}

function localDayKey(time: number): string {
  const day = new Date(time);
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
}

// Consecutive local calendar days with at least one reading. The run may end today or yesterday, so a
// streak is not broken until a whole day passes with no check. Days step back through the Date
// constructor, which keeps them right across daylight-saving changes.
function streakDays(readings: readonly StoredReading[], now: number): number {
  const days = new Set(readings.map((reading) => localDayKey(reading.takenAt)));
  const today = new Date(now);
  const dayBefore = (offset: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime();
  let offset = days.has(localDayKey(now)) ? 0 : 1;
  let streak = 0;
  while (days.has(localDayKey(dayBefore(offset)))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

// The latest reading decides status, heart rate, and both flags, so the widget never mixes results from
// different readings.
export function widgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const latest = latestReading(input.readings);
  const hr = latest?.outcome.metrics.hr ?? null;
  return {
    v: 1,
    updatedAt: isoSeconds(input.now),
    lastReadingAt: latest ? isoSeconds(latest.takenAt) : null,
    status: latest ? statusOf(latest.outcome) : null,
    hrBpm: input.hideValues || hr === null ? null : Math.round(hr.value),
    rhythmFlag: latest?.outcome.metrics.rhythm?.flag != null,
    diabetesFlag: latest ? showsDiabetesFlag(latest.outcome) : false,
    nextConfirmationAt: input.nextConfirmationAt === null ? null : isoSeconds(input.nextConfirmationAt),
    streakDays: streakDays(input.readings, input.now),
    hideValues: input.hideValues,
    theme: input.theme,
  };
}

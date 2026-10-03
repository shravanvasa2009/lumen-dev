import type { AnalysedReading } from '@/measure/analyzeKeptCapture';
import type { MeasureMode } from '@/measure/mode';
import type { FixtureReading } from '@/results/fixtures';

// §8.5: a demo reading is never saved to history or baselines, so it is held here for the Results screen
// and is gone when the app closes.
const demoReadings = new Map<string, FixtureReading>();

export function keepDemoReading(analysed: AnalysedReading, mode: MeasureMode): string {
  const id = `demo-${analysed.recordedMs}`;
  demoReadings.set(id, {
    id,
    mode,
    createdAt: new Date(analysed.recordedMs),
    sample: true,
    synthetic: true,
    scan: analysed.reading,
    intervalsMs: [],
    repeat: null,
    diabetesDays: [],
  });
  return id;
}

export function demoReadingById(id: string | undefined): FixtureReading | undefined {
  return id === undefined ? undefined : demoReadings.get(id);
}

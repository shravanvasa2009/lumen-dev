import type { Script } from './script';
import { visibleTexts } from './driver';

const RETRY_MS = 100;
// Both phones are opened by hand, within the same minute; the run starts on the next whole minute at least
// this far away, read from each phone's own network-set clock.
const MIN_LEAD_MS = 15_000;

export function nextStartMs(nowMs: number): number {
  return Math.ceil((nowMs + MIN_LEAD_MS) / 60_000) * 60_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => console.warn(`[showcase] ${message}`);

// Steps run in order, each no earlier than its second after the start. A step whose control never shows is
// logged with what was on screen and skipped, so one miss cannot push the rest of the film out of sync.
export async function runScript(script: Script, startMs: number): Promise<void> {
  log(`start at ${new Date(startMs).toISOString()}, ${script.steps.length} steps, ends at +${script.now}s`);
  for (const [index, step] of script.steps.entries()) {
    const dueMs = startMs + step.at * 1000;
    const next = script.steps[index + 1];
    // A missing control may wait only until the next step is due, so one miss never delays the rest.
    const nextDueMs = next === undefined || next.at <= step.at ? Infinity : startMs + next.at * 1000;
    const deadlineMs = Math.min(dueMs + step.graceS * 1000, nextDueMs);
    // Back from the background past the deadline (the widget beat): this step's moment has gone.
    if (Date.now() > deadlineMs) {
      log(`+${step.at.toFixed(1)}s ${step.label}: passed while away, skipped`);
      continue;
    }
    if (dueMs > Date.now()) await sleep(dueMs - Date.now());
    let done = false;
    let startedMs = Date.now();
    while (!done && Date.now() <= deadlineMs) {
      startedMs = Date.now();
      try {
        done = await step.attempt();
      } catch (error: unknown) {
        log(
          `+${step.at.toFixed(1)}s ${step.label} threw: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
      if (!done) await sleep(RETRY_MS);
    }
    const lateS = (startedMs - dueMs) / 1000;
    if (done)
      log(`+${step.at.toFixed(1)}s ${step.label}${lateS > 0.3 ? ` (late ${lateS.toFixed(1)}s)` : ''}`);
    else
      log(
        `+${step.at.toFixed(1)}s ${step.label}: not found. On screen: ${visibleTexts().slice(0, 40).join(' | ')}`,
      );
  }
  log('done');
}

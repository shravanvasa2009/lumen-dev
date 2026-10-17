import { useEffect } from 'react';

import { profileValue } from '@/store/profile';

import { nextStartMs, runScript } from './runner';
import { Script } from './script';
import { TapDots } from './TapDots';
import { setupSteps } from './walkthrough';

let started = false;

// One run per launch: a fresh start (setup not done) films the walkthrough.
async function startRun(): Promise<void> {
  const onboarded = (await profileValue('onboardingDone')) === 'true';
  const startMs = nextStartMs(Date.now());
  if (onboarded) {
    console.warn('[showcase] setup is already done; delete all data and reopen to film the walkthrough');
    return;
  }
  const reminder = new Date(startMs + 10 * 60_000);
  const script = setupSteps(new Script(), { hour: reminder.getHours(), minute: reminder.getMinutes() });
  await runScript(script, startMs);
}

export function ShowcaseHost() {
  useEffect(() => {
    if (started) return;
    started = true;
    startRun().catch((error: unknown) =>
      console.warn(`[showcase] run failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, []);
  return <TapDots />;
}

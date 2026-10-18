import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

import { profileValue } from '@/store/profile';
import { currentPreferences, setPreference } from '@/theme/preferences';
import { publishWidgets } from '@/widgets/publish';

import { nextStartMs, runScript } from './runner';
import { Script } from './script';
import { TapDots } from './TapDots';
import cues from './cues.json';
import { scanSteps } from './scan';
import { seedHistory } from './seedHistory';
import { setupSteps, tourSteps } from './walkthrough';

const KEEP_AWAKE_TAG = 'lumen-showcase';

let started = false;

async function runAwake(script: Script, startMs: number): Promise<void> {
  // Scripted presses are not touches, so without this the screen would dim and lock mid-film.
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
  try {
    await runScript(script, startMs);
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  }
}

// One run per launch: a fresh start (setup not done) films the walkthrough; a launch after setup films the
// scan.
async function startRun(): Promise<void> {
  // Both films are shot in light mode (owner, 2026-10-17).
  setPreference('appearance', 'light');
  const onboarded = (await profileValue('onboardingDone')) === 'true';
  const startMs = nextStartMs(Date.now());
  if (onboarded) {
    await runAwake(scanSteps(new Script()), startMs);
    return;
  }
  // A month of mornings is already there when setup starts, so Home, Trends and the widgets have history.
  const seeded = await seedHistory(Date.now());
  if (seeded > 0) await publishWidgets(currentPreferences());
  console.warn(`[showcase] seeded ${seeded} readings`);
  // The start is a whole minute and the reminder cue a whole number of minutes after it.
  const reminder = new Date(startMs + cues.reminder * 1000);
  const script = tourSteps(
    setupSteps(new Script(), { hour: reminder.getHours(), minute: reminder.getMinutes() }),
  );
  await runAwake(script, startMs);
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

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

import { profileValue } from '@/store/profile';
import { currentPreferences } from '@/theme/preferences';
import { publishWidgets } from '@/widgets/publish';

import { nextStartMs, runScript } from './runner';
import { Script } from './script';
import { TapDots } from './TapDots';
import cues from './cues.json';
import { seedHistory } from './seedHistory';
import { setupSteps, tourSteps } from './walkthrough';

const KEEP_AWAKE_TAG = 'lumen-showcase';

let started = false;

// One run per launch: a fresh start (setup not done) films the walkthrough.
async function startRun(): Promise<void> {
  const onboarded = (await profileValue('onboardingDone')) === 'true';
  const startMs = nextStartMs(Date.now());
  if (onboarded) {
    console.warn('[showcase] setup is already done; delete all data and reopen to film the walkthrough');
    return;
  }
  // A month of mornings is already there when setup starts, so Home, Trends and the widgets have history.
  const seeded = await seedHistory(Date.now());
  if (seeded > 0) await publishWidgets(currentPreferences());
  console.warn(`[showcase] seeded ${seeded} readings`);
  // The start is a whole minute and the reminder cue a whole number of minutes after it.
  const reminder = new Date(startMs + cues.reminder * 1000);
  const script = tourSteps(setupSteps(new Script(), { hour: reminder.getHours(), minute: reminder.getMinutes() }));
  // Scripted presses are not touches, so without this the screen would dim and lock mid-film.
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
  try {
    await runScript(script, startMs);
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  }
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

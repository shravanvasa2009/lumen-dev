// Spoken cues for Nitin during the setup film's widget beat: the app cannot press Home, lock the iPhone or
// unlock it, so he does it when the Mac speaks, on the same seconds the app and the A17 driver use
// (apps/mobile/src/showcase/cues.json). Start it in the same minute you open the app.
// Usage (on the Mac): node tools/showcase/iphone-cues.mjs [--start <ISO time>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cues = JSON.parse(readFileSync(new URL('../../apps/mobile/src/showcase/cues.json', import.meta.url)));
const MIN_LEAD_MS = 15_000;
// Spoken this many seconds early, so the press lands on the cue second.
const SAY_EARLY_S = 1;

// The same start as runner.ts nextStartMs(now, cues.reminder): the reminder second falls on a whole minute.
const offsetMs = (cues.reminder % 60) * 1000;
const at = process.argv.indexOf('--start');
const startMs =
  at > 0
    ? Date.parse(process.argv[at + 1])
    : Math.ceil((Date.now() + MIN_LEAD_MS + offsetMs) / 60_000) * 60_000 - offsetMs;

// macOS has `say`; anywhere else the cue is printed with a terminal bell.
const speak = (words) => {
  console.log(`\u0007${new Date().toLocaleTimeString()}  ${words}`);
  if (process.platform === 'darwin') execFileSync('say', [words]);
};
const sleepUntil = (second) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, startMs + (second - SAY_EARLY_S) * 1000 - Date.now())));

const beats = [
  [cues.reminder - 5, 'Get ready. Reminder coming.'],
  [cues.home, 'Home. Swipe up.'],
  [cues.screenOff, 'Lock. Press the side button.'],
  [cues.lockScreen, 'Wake. Tap the screen.'],
  [cues.unlock, 'Unlock. Swipe up.'],
  [cues.widgetTap, 'Tap the Lumen widget.'],
];

console.log(`Run starts at ${new Date(startMs).toLocaleTimeString()}. Keep this Mac's sound on.`);
for (const [second, words] of beats) {
  await sleepUntil(second);
  speak(words);
}
speak('Done. Hands off.');

// Drives the Galaxy A17's system screens during the setup film's widget beat, on the same cues the app reads
// (apps/mobile/src/showcase/cues.json): Home with the Lumen widget, the lock screen with the reminder, unlock,
// then a tap on the widget. Start it in the same minute you open the app; it picks the same start the app does.
// The A17 has no screen lock credential, so a swipe unlocks it.
// Usage: node tools/showcase/a17-driver.mjs --widget x,y [--start <ISO time>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cues = JSON.parse(readFileSync(new URL('../../apps/mobile/src/showcase/cues.json', import.meta.url)));
const MIN_LEAD_MS = 15_000;

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
// The same start as runner.ts nextStartMs(now, cues.reminder): the reminder second falls on a whole minute.
const offsetMs = (cues.reminder % 60) * 1000;
const startMs = flag('--start')
  ? Date.parse(flag('--start'))
  : Math.ceil((Date.now() + MIN_LEAD_MS + offsetMs) / 60_000) * 60_000 - offsetMs;
// Where the Lumen widget sits on the home screen, in screen pixels.
const widget = flag('--widget')?.split(',').map(Number);
if (widget?.length !== 2 || widget.some(Number.isNaN)) throw new Error('Give --widget x,y (the Lumen widget on Home)');

const adb = (...args) => execFileSync('adb', ['shell', ...args], { stdio: 'inherit' });
const sleepUntil = (second) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, startMs + second * 1000 - Date.now())));

console.log(`start ${new Date(startMs).toLocaleTimeString()}`);
await sleepUntil(cues.home);
adb('input', 'keyevent', 'KEYCODE_HOME');
console.log('home');
await sleepUntil(cues.screenOff);
adb('input', 'keyevent', 'KEYCODE_SLEEP');
await sleepUntil(cues.lockScreen);
adb('input', 'keyevent', 'KEYCODE_WAKEUP');
console.log('lock screen');
await sleepUntil(cues.unlock);
adb('input', 'swipe', '540', '1900', '540', '700', '250');
console.log('unlocked');
await sleepUntil(cues.widgetTap);
adb('input', 'tap', String(widget[0]), String(widget[1]));
console.log('widget tapped');

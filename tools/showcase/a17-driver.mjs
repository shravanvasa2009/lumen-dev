// Drives the Galaxy A17's system screens during the walkthrough's widget beat, on the same wall-clock cues the
// app reads (apps/mobile/src/showcase/cues.json). Start it in the same minute you open the app; it picks the
// same start minute the app does. Usage: node tools/showcase/a17-driver.mjs [--start <ISO time>] [--widget x,y]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cues = JSON.parse(readFileSync(new URL('../../apps/mobile/src/showcase/cues.json', import.meta.url)));
const PACKAGE = 'io.github.shravanvasa2009.heartcheck.showcase';
const MIN_LEAD_MS = 15_000;

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const startMs = flag('--start')
  ? Date.parse(flag('--start'))
  : Math.ceil((Date.now() + MIN_LEAD_MS) / 60_000) * 60_000;
// Where the Lumen widget sits on the home screen, in screen pixels; without it the app is reopened instead.
const widget = flag('--widget')?.split(',').map(Number);

const adb = (...args) => execFileSync('adb', ['shell', ...args], { stdio: 'inherit' });
const sleepUntil = (second) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, startMs + second * 1000 - Date.now())));

console.log(`start ${new Date(startMs).toISOString()}`);
await sleepUntil(cues.home);
adb('input', 'keyevent', 'KEYCODE_HOME');
console.log('home');
await sleepUntil(cues.shadeOpen);
adb('cmd', 'statusbar', 'expand-notifications');
console.log('notifications open');
await sleepUntil(cues.shadeClose);
adb('cmd', 'statusbar', 'collapse');
console.log('notifications closed');
await sleepUntil(cues.widgetTap);
if (widget) adb('input', 'tap', String(widget[0]), String(widget[1]));
else adb('monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
console.log(widget ? 'widget tapped' : 'app reopened');

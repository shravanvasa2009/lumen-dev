// Puts the A17's showcase app back to a fresh install before a take: data cleared, camera and notifications
// allowed (so no system dialog appears in the film), location denied without asking (the care map then
// searches by ZIP code). Usage: node tools/showcase/a17-reset.mjs
import { execFileSync } from 'node:child_process';

const PACKAGE = 'io.github.shravanvasa2009.heartcheck.showcase';
const adb = (...args) => execFileSync('adb', ['shell', ...args], { stdio: 'inherit' });

adb('pm', 'clear', PACKAGE);
for (const permission of ['CAMERA', 'POST_NOTIFICATIONS'])
  adb('pm', 'grant', PACKAGE, `android.permission.${permission}`);
for (const permission of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']) {
  adb('pm', 'revoke', PACKAGE, `android.permission.${permission}`);
  adb('pm', 'set-permission-flags', PACKAGE, `android.permission.${permission}`, 'user-set', 'user-fixed');
}
console.log('showcase app reset');

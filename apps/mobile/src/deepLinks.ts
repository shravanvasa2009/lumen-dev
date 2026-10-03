// Widgets and notifications open the app through three short links (spec §9.6). expo-router hands every
// incoming system URL here (through app/+native-intent.tsx) before it routes, and notification taps pass
// their links here too, so those links are rewritten to the screens they stand for and every other URL
// (in-app paths, dev-client links) passes through untouched.
// https://docs.expo.dev/router/advanced/native-intent/
const CHECK = /^lumen:\/\/check\/?(\?[^#]*)?$/i;
const STANDING = /^lumen:\/\/standing\/?$/i;
const FULL_MODE = /[?&]mode=full(&|$)/i;

export function redirectSystemPath({ path }: { path: string }): string {
  const check = CHECK.exec(path);
  if (check) {
    // Spec §9.6: lumen://check is the Quick Check; only ?mode=full asks for the Full Scan.
    const mode = FULL_MODE.test(check[1] ?? '') ? 'full' : 'quick';
    return `/measure/precheck?mode=${mode}`;
  }
  if (STANDING.test(path)) return '/measure/standing-test';
  return path;
}

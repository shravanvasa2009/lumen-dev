import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs the Maestro flows in apps/mobile/.maestro against a release APK on whichever emulator adb sees.
// Release, not the dev client: its JavaScript is bundled in, so no Metro server and no dev launcher sheet.
const MOBILE = 'apps/mobile';
const FLOWS = path.join(MOBILE, '.maestro');
const ANDROID = path.join(MOBILE, 'android');
const APK_DIR = path.join(ANDROID, 'app/build/outputs/apk');
const RELEASE_APK = path.join(APK_DIR, 'release/app-release.apk');
const DEBUG_APK = path.join(APK_DIR, 'debug/app-debug.apk');
const isWindows = process.platform === 'win32';

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const outcome = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
  if (outcome.error) throw outcome.error;
  return outcome.status ?? 1;
}

function runOrExit(command, args, options) {
  const status = run(command, args, options);
  if (status !== 0) process.exit(status);
}

// The Windows install is an unzipped release with no PATH change, so also look in the default folder.
function maestroCommand() {
  const onPath = spawnSync(isWindows ? 'where' : 'which', ['maestro'], { stdio: 'ignore' }).status === 0;
  if (onPath) return 'maestro';
  const local = path.join(os.homedir(), '.maestro', 'bin', isWindows ? 'maestro.bat' : 'maestro');
  // Windows runs through a shell, where a path with spaces needs quotes; elsewhere quotes would be literal.
  if (fs.existsSync(local)) return isWindows ? `"${local}"` : local;
  console.error(
    'e2e:android: Maestro CLI 2.11.0 not found. Install: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli',
  );
  process.exit(1);
}

const maestro = maestroCommand();

if (spawnSync('adb', ['get-state'], { stdio: 'ignore', shell: isWindows }).status !== 0) {
  console.error('e2e:android: no emulator or device. Start Pixel_10_Pro_XL (or any emulator) first.');
  process.exit(1);
}

if (fs.existsSync(RELEASE_APK) && !process.argv.includes('--rebuild')) {
  console.log(
    `Reusing ${RELEASE_APK} (${fs.statSync(RELEASE_APK).mtime.toISOString()}); pass --rebuild after changes.`,
  );
} else {
  if (!fs.existsSync(ANDROID)) runOrExit('npx', ['expo', 'prebuild', '-p', 'android'], { cwd: MOBILE });
  runOrExit(
    isWindows ? 'gradlew.bat' : './gradlew',
    ['app:assembleRelease', '-PreactNativeArchitectures=x86_64'],
    {
      cwd: ANDROID,
    },
  );
}

runOrExit('adb', ['install', '-r', RELEASE_APK]);
// Java 17 reads files in the system code page (cp1252 on Windows), which turns the flows' em dashes into '?'.
const status = run(maestro, ['test', FLOWS], {
  env: { ...process.env, JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8' },
});

// The release APK replaced the development client (same application id); put it back for local Metro work.
if (fs.existsSync(DEBUG_APK)) run('adb', ['install', '-r', DEBUG_APK]);

process.exit(status);

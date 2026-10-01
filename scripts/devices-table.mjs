import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec §5.4: README's tested-devices table is generated from packages/device-db/devices.json.
// The tier is the one the app showed during the test (measured.rating), not recomputed here, so the
// table never disagrees with the rating formula in @lumen/core.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEVICES = path.join(ROOT, 'packages/device-db/devices.json');
const README = path.join(ROOT, 'README.md');
const INTRO = 'Generated from `packages/device-db/devices.json` by `npm run devices:table`.';
const HEADER = [
  '| Phone | Tier | HR error vs ECG strap | Interval error | Notes |',
  '| ----- | ---- | --------------------- | -------------- | ----- |',
];

const orDash = (value, unit) => (value == null ? '—' : `${value} ${unit}`);

function notesFor(device) {
  if (device.status !== 'measured') return 'Not tested yet';
  // §14.3: Android stays camera-unverified until a real Android phone has been tested.
  const parts = device.match.platform === 'android' ? ['camera unverified'] : [];
  if (device.measured.testedOn) parts.push(`tested ${device.measured.testedOn}`);
  return parts.join('; ') || '—';
}

export function renderTable(devices) {
  const rows = devices.map((device) => {
    const tested = device.status === 'measured';
    const cells = [
      device.displayName,
      tested ? (device.measured.rating ?? '—') : '—',
      tested ? orDash(device.measured.hrMaeBpm, 'bpm') : '—',
      tested ? orDash(device.measured.intervalMaeMs, 'ms') : '—',
      notesFor(device),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  return [...HEADER, ...rows].join('\n');
}

export function replaceTable(readme, table) {
  const start = readme.indexOf(INTRO);
  if (start === -1) throw new Error(`README.md has no line "${INTRO}"`);
  const tableStart = readme.indexOf('\n|', start) + 1;
  const tableEnd = readme.indexOf('\n\n', tableStart);
  return `${readme.slice(0, tableStart)}${table}${readme.slice(tableEnd)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const readme = fs.readFileSync(README, 'utf8');
  const updated = replaceTable(readme, renderTable(JSON.parse(fs.readFileSync(DEVICES, 'utf8'))));
  if (process.argv.includes('--check')) {
    if (updated !== readme) {
      console.error('README.md tested-devices table is out of date; run npm run devices:table');
      process.exit(1);
    }
    console.log('devices:table OK: README matches devices.json');
  } else {
    fs.writeFileSync(README, updated);
    console.log('README.md tested-devices table updated');
  }
}

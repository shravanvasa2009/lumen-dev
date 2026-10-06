import fs from 'node:fs';
import path from 'node:path';

// WID-2: lock-screen widgets and notifications never show health values or condition names, in any
// language. The strings live in one file so this check sees everything the lock screen can show, plus the
// Android lock-screen widget's res copies of them (its picker line, preview, and pre-publish fallback).
const copy = JSON.parse(fs.readFileSync('apps/mobile/src/i18n/lockscreen.json', 'utf8'));
const RES = 'apps/mobile/modules/lumen-widgets/android/src/main/res';
const LOCK_RES = 'lumen_widget_lock_strings.xml';
if (!fs.existsSync(path.join(RES, 'values', LOCK_RES))) {
  console.error(`WID-2 failed: ${RES}/values/${LOCK_RES} is missing`);
  process.exit(1);
}
const lockResFolders = fs
  .readdirSync(RES)
  .filter((folder) => /^values(-|$)/.test(folder) && fs.existsSync(path.join(RES, folder, LOCK_RES)));
for (const folder of lockResFolders) {
  const xml = fs.readFileSync(path.join(RES, folder, LOCK_RES), 'utf8');
  copy[`android ${folder}`] = Object.fromEntries(
    [...xml.matchAll(/<string name="([a-z0-9_]+)"[^>]*>([^<]*)<\/string>/g)].map(([, name, text]) => [
      name,
      text.replace(/\'/g, "'").replace(/&amp;/g, '&'),
    ]),
  );
}
const BANNED = [
  /\d+\s*(bpm|lpm)\b/i,
  /\bafib\b/i,
  /\bfibrilaci[oó]n\b/i,
  /\bdiabet/i,
  /\bpots\b/i,
  /\bpsvt\b/i,
  /\btsvp\b/i,
  /\bflag/i,
  /\birregular\b/i,
  /\barritmia\b/i,
  /\bheart rate\b/i,
  /\bfrecuencia card[ií]aca\b/i,
];
const failures = [];
for (const [lang, strings] of Object.entries(copy)) {
  for (const [key, text] of Object.entries(strings)) {
    const hit = BANNED.find((pattern) => pattern.test(text));
    if (hit) failures.push(`${lang} ${key}: "${text}" matches ${hit}`);
  }
}
if (failures.length) {
  console.error(`WID-2 failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(
  `WID-2 OK: ${Object.values(copy).reduce((n, s) => n + Object.keys(s).length, 0)} lock-screen strings are free of health details`,
);

import fs from 'node:fs';

// WID-2: lock-screen widgets and notifications never show health values or condition names, in any
// language. The strings live in one file so this check sees everything the lock screen can show.
const copy = JSON.parse(fs.readFileSync('apps/mobile/src/i18n/lockscreen.json', 'utf8'));
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

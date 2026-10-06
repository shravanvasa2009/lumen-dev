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
// Android's own escapes and the XML entities, so the banned patterns see the text the widget shows.
const unescapeAndroid = (text) =>
  text
    .replace(/\\(['"@?])/g, '$1')
    .replace(/\\[nt]/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

// Fails closed: every <string> and every <item> of a <plurals> or <string-array> must be plain text. Markup
// (<b>, <xliff:g>, CDATA) could hide a value from the patterns below, and the lock widget needs none, so a string
// with markup, or any entry the patterns here don't read, is a failure rather than skipped.
const unreadable = [];
function readLockStrings(xml, where) {
  const strings = {};
  for (const [, name, body] of xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g))
    strings[name] = body;
  for (const [, kind, name, items] of xml.matchAll(
    /<(plurals|string-array)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    [...items.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].forEach(([, body], index) => {
      strings[`${kind} ${name}[${index}]`] = body;
    });
  }
  const entries = (xml.match(/<string[\s>]/g) ?? []).length + (xml.match(/<item[\s>]/g) ?? []).length;
  if (Object.keys(strings).length !== entries)
    unreadable.push(`${where}: read ${Object.keys(strings).length} of ${entries} entries`);
  for (const [name, body] of Object.entries(strings)) {
    if (/[<>]/.test(body)) unreadable.push(`${where} ${name}: markup this check can't read: ${body.trim()}`);
    else strings[name] = unescapeAndroid(body);
  }
  return strings;
}

const lockResFolders = fs
  .readdirSync(RES)
  .filter((folder) => /^values(-|$)/.test(folder) && fs.existsSync(path.join(RES, folder, LOCK_RES)));
for (const folder of lockResFolders) {
  const xml = fs.readFileSync(path.join(RES, folder, LOCK_RES), 'utf8');
  copy[`android ${folder}`] = readLockStrings(xml, `${folder}/${LOCK_RES}`);
}
if (unreadable.length) {
  console.error(`WID-2 failed:\n${unreadable.join('\n')}`);
  process.exit(1);
}
const BANNED = [
  // The unit alone: a placeholder ("%d bpm", "{{bpm}} lpm") is a value once filled in.
  /\b(bpm|lpm)\b/i,
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

import fs from 'node:fs';

// Diabetes wording rule (§11.4): user-facing diabetes text never claims a diagnosis or a glucose value.
const copy = JSON.parse(fs.readFileSync('apps/mobile/src/i18n/diabetes.json', 'utf8'));
const BANNED = [
  /you have/i,
  /diagnosed/i,
  /blood sugar is/i,
  /glucose/i,
  /\btienes\b/i,
  /diagnosticad/i,
  /az[uú]car en (la )?sangre es/i,
  /glucosa/i,
];
const REQUIRED = { en: /not a diabetes test/i, es: /no es una prueba de diabetes/i };
// The diabetes questionnaire (dr.*), result card (dm.*) and the other known diabetes strings live in en.json
// and es.json, outside diabetes.json, so the same ban must cover them.
// A diabetes string under a prefix not listed here is not checked; add its prefix when adding such copy.
const DIABETES_KEY_PREFIXES = [
  'dr.',
  'dm.',
  'checks.diabetes',
  'checks.status.dm',
  'followUp.whatToAskBody',
  'profile.diabetes',
  'results.diabetes',
  'results.notDiabetesTest',
  'report.diabetes',
  'accuracy.diabetes',
  'accuracy.notDiabetesTest',
  'widgets.checkDiabetes',
  'learn.diabetes',
  'learn.lessonDiabetes',
];
const failures = [];
for (const lang of ['en', 'es']) {
  const strings = JSON.parse(fs.readFileSync(`apps/mobile/src/i18n/${lang}.json`, 'utf8'));
  for (const [key, text] of Object.entries(strings)) {
    if (!DIABETES_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const hit = BANNED.find((pattern) => pattern.test(text));
    if (hit) failures.push(`${lang}.json ${key}: "${text}" matches ${hit}`);
  }
}
for (const [lang, strings] of Object.entries(copy)) {
  for (const [key, text] of Object.entries(strings)) {
    const hit = BANNED.find((pattern) => pattern.test(text));
    if (hit) failures.push(`${lang} ${key}: "${text}" matches ${hit}`);
  }
  if (!REQUIRED[lang].test(strings['dm.flag.body'] ?? ''))
    failures.push(`${lang} dm.flag.body must say it is not a diabetes test`);
}
if (failures.length) {
  console.error(`Diabetes wording failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Diabetes wording OK in English and Spanish');

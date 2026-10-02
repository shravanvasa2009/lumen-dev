import fs from 'node:fs';
import ts from 'typescript';

import {
  COPY_FILES,
  jsonKeyLines,
  lineOf,
  mobileSourceFiles,
  parseSource,
  visitNodes,
} from './lib/mobile-sources.mjs';

// UI-2: en.json and es.json agree, and the code uses exactly the keys they define.
const PLACEHOLDER = /\{\{\s*([^,}\s]+)[^}]*\}\}/g;
const placeholders = (text) => new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]));
const sameSet = (left, right) => left.size === right.size && [...left].every((item) => right.has(item));

// i18next plural forms: t('k', { count }) reads k_one, k_other and the like, so the code names only k.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const hasKey = (texts, key) => key in texts || `${key}_other` in texts;

// The call is t(...) or i18n.t(...); a non-literal key cannot be checked or counted as used, so it fails.
function isTranslationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

// copy is { en, es } key-to-text maps; keyLines is { en, es } key-to-line maps (empty in the self-test);
// sources is [{ file, text }].
function findProblems(copy, keyLines, sources) {
  const failures = [];
  const where = (language, key) => `${COPY_FILES[language]}:${keyLines[language].get(key) ?? 0}`;

  for (const [language, other] of [
    ['en', 'es'],
    ['es', 'en'],
  ]) {
    for (const key of Object.keys(copy[language])) {
      if (!(key in copy[other]))
        failures.push(`${where(language, key)}: "${key}" is missing from ${COPY_FILES[other]}`);
    }
  }
  for (const key of Object.keys(copy.en)) {
    if (key in copy.es && !sameSet(placeholders(copy.en[key]), placeholders(copy.es[key])))
      failures.push(`${where('es', key)}: "${key}" has different {{placeholders}} in en and es`);
  }

  const usedKeys = new Set();
  for (const { file, text } of sources) {
    const sourceFile = parseSource(file, text);
    const useKey = (keyNode, node) => {
      if (ts.isStringLiteralLike(keyNode)) {
        usedKeys.add(keyNode.text);
        if (!hasKey(copy.en, keyNode.text) || !hasKey(copy.es, keyNode.text))
          failures.push(
            `${file}:${lineOf(sourceFile, node)}: key "${keyNode.text}" is not in both en.json and es.json`,
          );
      } else {
        failures.push(
          `${file}:${lineOf(sourceFile, node)}: translation key is not a string literal, so it cannot be checked`,
        );
      }
    };
    visitNodes(sourceFile, (node) => {
      if (isTranslationCall(node) && node.arguments[0]) useKey(node.arguments[0], node);
      if (ts.isJsxAttribute(node) && node.name.text === 'i18nKey' && node.initializer) {
        const keyNode = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (keyNode) useKey(keyNode, node);
      }
    });
  }

  for (const language of Object.keys(COPY_FILES)) {
    for (const key of Object.keys(copy[language])) {
      if (!usedKeys.has(key.replace(PLURAL_SUFFIX, '')) && !usedKeys.has(key))
        failures.push(`${where(language, key)}: "${key}" is not used by any screen or component`);
    }
  }
  return failures;
}

// Runs on every call so a weakened check fails here, not only in review.
function selfTest() {
  const noLines = { en: new Map(), es: new Map() };
  const screen = (body) => [{ file: 'probe.tsx', text: body }];
  const good = { en: { 'a.b': 'Hi {{name}}' }, es: { 'a.b': 'Hola {{name}}' } };
  const plural = {
    en: { 'a.n_one': '{{count}} item', 'a.n_other': '{{count}} items' },
    es: { 'a.n_one': '{{count}} cosa', 'a.n_other': '{{count}} cosas' },
  };
  const probes = [
    ['a key missing from es', { en: { 'a.b': 'x' }, es: {} }, "t('a.b')"],
    [
      'a placeholder mismatch',
      { en: { 'a.b': 'Hi {{name}}' }, es: { 'a.b': 'Hola {{nombre}}' } },
      "t('a.b')",
    ],
    ['an unused key', good, 'const unused = 1;'],
    ['an unresolved t() key', good, "t('a.b'); t('a.missing');"],
    ['a dynamic t() key', good, "t('a.b'); t(name);"],
    ['an unused plural key', plural, 'const unused = 1;'],
  ];
  const wrong = probes
    .filter(([, copy, body]) => findProblems(copy, noLines, screen(body)).length === 0)
    .map(([what]) => `check missed ${what}`);
  if (findProblems(good, noLines, screen("t('a.b', { name })")).length > 0)
    wrong.push('check rejected a valid key and placeholder set');
  if (findProblems(plural, noLines, screen("t('a.n', { count })")).length > 0)
    wrong.push('check rejected plural forms');
  return wrong;
}

const selfTestFailures = selfTest();
if (selfTestFailures.length) {
  console.error(`i18n:check self-test failed:\n${selfTestFailures.join('\n')}`);
  process.exit(1);
}

const copy = {};
const keyLines = {};
for (const [language, file] of Object.entries(COPY_FILES)) {
  const text = fs.readFileSync(file, 'utf8');
  copy[language] = JSON.parse(text);
  keyLines[language] = jsonKeyLines(text);
}
const sources = mobileSourceFiles(['.ts', '.tsx']).map((file) => ({
  file,
  text: fs.readFileSync(file, 'utf8'),
}));
const failures = findProblems(copy, keyLines, sources);
if (failures.length) {
  console.error(`i18n check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK: ${Object.keys(copy.en).length} keys in English and Spanish, all used`);

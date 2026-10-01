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

const failures = [];
const copy = {};
const keyLines = {};
for (const [language, file] of Object.entries(COPY_FILES)) {
  const text = fs.readFileSync(file, 'utf8');
  copy[language] = JSON.parse(text);
  keyLines[language] = jsonKeyLines(text);
}

for (const [language, other] of [
  ['en', 'es'],
  ['es', 'en'],
]) {
  for (const key of Object.keys(copy[language])) {
    if (!(key in copy[other]))
      failures.push(
        `${COPY_FILES[language]}:${keyLines[language].get(key)}: "${key}" is missing from ${COPY_FILES[other]}`,
      );
  }
}
for (const key of Object.keys(copy.en)) {
  if (!(key in copy.es)) continue;
  if (!sameSet(placeholders(copy.en[key]), placeholders(copy.es[key])))
    failures.push(
      `${COPY_FILES.es}:${keyLines.es.get(key)}: "${key}" has different {{placeholders}} in en and es`,
    );
}

// The call is t(...) or i18n.t(...); a non-literal key cannot be checked or counted as used, so it fails.
function isTranslationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

const usedKeys = new Set();
for (const file of mobileSourceFiles(['.ts', '.tsx'])) {
  const sourceFile = parseSource(file, fs.readFileSync(file, 'utf8'));
  const useKey = (keyNode, node) => {
    if (ts.isStringLiteralLike(keyNode)) {
      usedKeys.add(keyNode.text);
      if (!(keyNode.text in copy.en) || !(keyNode.text in copy.es))
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
    if (!usedKeys.has(key))
      failures.push(
        `${COPY_FILES[language]}:${keyLines[language].get(key)}: "${key}" is not used by any screen or component`,
      );
  }
}

if (failures.length) {
  console.error(`i18n check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK: ${Object.keys(copy.en).length} keys in English and Spanish, all used`);

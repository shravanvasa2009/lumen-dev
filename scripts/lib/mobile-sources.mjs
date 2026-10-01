import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const MOBILE_SOURCE_DIRS = ['apps/mobile/app', 'apps/mobile/src'];
export const COPY_FILES = { en: 'apps/mobile/src/i18n/en.json', es: 'apps/mobile/src/i18n/es.json' };

// Tests assert on copy and may hold literal strings, so the UI guards read production code only.
export function mobileSourceFiles(extensions) {
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext)) && !/\.test\.tsx?$/.test(entry.name))
        found.push(full);
    }
  };
  for (const dir of MOBILE_SOURCE_DIRS) {
    if (!fs.existsSync(dir)) throw new Error(`${dir} not found; run this from the repo root`);
    visit(dir);
  }
  if (found.length === 0)
    throw new Error(`no ${extensions.join('/')} files found under ${MOBILE_SOURCE_DIRS.join(', ')}`);
  return found.sort();
}

export function parseSource(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function visitNodes(node, onNode) {
  onNode(node);
  ts.forEachChild(node, (child) => visitNodes(child, onNode));
}

// Line of a flat JSON key, for file:line reports; JSON.parse does not keep positions.
export function jsonKeyLines(text) {
  const lines = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/);
    if (match) lines.set(JSON.parse(`"${match[1]}"`), index + 1);
  });
  return lines;
}

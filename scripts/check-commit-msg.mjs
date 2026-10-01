import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const TYPES = 'feat|fix|docs|test|refactor|perf|build|ci|chore|revert';
// Prefixes are the requirement IDs in spec §18; milestones are M0–M6 plus M4d.
const TAG =
  /\[(CAP|DSP|RESP|ML|VER|EVID|UI|UX|COMP|PRIV|SAFE|SCOPE|REL|BRAND|WID|NOTIF|LIVE)-[A-Z0-9]+\]|\[M([0-6]|4d)\]|\[BOOT\]/;
const HYPE = [
  'comprehensive',
  'robust',
  'seamless',
  'seamlessly',
  'powerful',
  'enhance',
  'enhanced',
  'enhances',
  'leverage',
  'leverages',
  'leveraging',
  'significant',
  'significantly',
  'various',
];

export function commitMessageProblems(message) {
  const subject = message.split(/\r?\n/)[0].trim();
  const problems = [];
  if (!new RegExp(`^(${TYPES})(\\([a-z0-9-]+\\))?: \\S`).test(subject))
    problems.push(
      `subject must look like "type(scope): summary [REQ-ID]" (types: ${TYPES.replaceAll('|', ', ')})`,
    );
  if (subject.length > 72) problems.push(`subject is ${subject.length} characters; the limit is 72`);
  if (!TAG.test(subject))
    problems.push('subject must cite a requirement tag such as [DSP-7], [M0], or [BOOT]');
  const hype = HYPE.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(message));
  if (hype.length) problems.push(`remove hype words: ${hype.join(', ')}`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv.indexOf('--message');
  const message = flag > 0 ? process.argv[flag + 1] : fs.readFileSync(process.argv[2], 'utf8');
  const problems = commitMessageProblems(message ?? '');
  if (problems.length) {
    console.error(`Commit message rejected:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Commit message OK');
}

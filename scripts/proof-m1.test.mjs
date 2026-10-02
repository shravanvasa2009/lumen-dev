import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failureExcerpt } from './proof/m1.mjs';

test('a failing workspace is named even when a later one prints only PASS lines', () => {
  const step = {
    stdout: '> lumen@0.0.0 test\n',
    stderr: [
      'PASS src/home.test.tsx',
      'FAIL src/report/reportShare.test.tsx',
      '  ● share › opens the sheet',
      '    thrown: "Exceeded timeout of 5000 ms for a test."',
      'npm error Lifecycle script "test" failed with error:',
      'PASS test/filters.test.ts',
      'Tests:       160 passed, 160 total',
    ].join('\n'),
  };
  assert.equal(
    failureExcerpt(step),
    [
      'FAIL src/report/reportShare.test.tsx',
      '  ● share › opens the sheet',
      'npm error Lifecycle script "test" failed with error:',
    ].join('\n'),
  );
});

test('node --test failures and thrown errors are named', () => {
  const step = { stdout: 'ok 1 - a\nnot ok 2 - b\n', stderr: 'TypeError: x is not a function\n' };
  assert.equal(failureExcerpt(step), 'not ok 2 - b\nTypeError: x is not a function');
});

test('without a recognisable line, the last 30 non-blank lines are shown', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const excerpt = failureExcerpt({ stdout: lines.join('\n'), stderr: '\n\n' }).split('\n');
  assert.deepEqual(excerpt, lines.slice(10));
});

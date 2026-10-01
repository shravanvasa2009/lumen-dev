import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitMessageProblems } from './check-commit-msg.mjs';

const subject = 'fix(core): correct the resample edge case [DSP-3]';

test('accepts a body whose lines are at most 100 characters', () => {
  assert.deepEqual(commitMessageProblems(`${subject}\n\n${'a'.repeat(100)}`), []);
});

test('rejects a body line longer than 100 characters', () => {
  const problems = commitMessageProblems(`${subject}\n\n${'a'.repeat(101)}`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /over 100 characters/);
});

test('allows a long body line that contains a URL, like commitlint', () => {
  const link = `See https://example.com/${'a'.repeat(120)}`;
  assert.deepEqual(commitMessageProblems(`${subject}\n\n${link}`), []);
});

test('ignores git comment lines', () => {
  assert.deepEqual(commitMessageProblems(`${subject}\n\n# ${'a'.repeat(120)}`), []);
});

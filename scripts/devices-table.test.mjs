import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTable, replaceTable } from './devices-table.mjs';

const device = (overrides) => ({
  id: 'phone-x',
  displayName: 'Phone X',
  match: { platform: 'ios' },
  measured: { rating: null, hrMaeBpm: null, intervalMaeMs: null, testedOn: null },
  status: 'placeholder',
  ...overrides,
});
const rowOf = (phone) => renderTable([phone]).split('\n')[2];

test('a placeholder phone shows no numbers', () => {
  assert.equal(rowOf(device()), '| Phone X | — | — | — | Not tested yet |');
});

test('a measured phone shows its tier, score, and errors', () => {
  const measured = {
    rating: { score: 86, tier: 'full' },
    hrMaeBpm: 1.8,
    intervalMaeMs: 14,
    testedOn: '2026-10-20',
  };
  assert.equal(
    rowOf(device({ status: 'measured', measured })),
    '| Phone X | Full (86) | 1.8 bpm | 14 ms | tested 2026-10-20 |',
  );
});

test('an untested Android phone is camera unverified', () => {
  assert.match(rowOf(device({ match: { platform: 'android' } })), /\| Not tested yet; camera unverified \|$/);
});

test('a tested Android phone is no longer camera unverified', () => {
  const measured = { rating: { score: 55, tier: 'basic' }, hrMaeBpm: 2.5, intervalMaeMs: 30, testedOn: null };
  const row = rowOf(device({ status: 'measured', match: { platform: 'android' }, measured }));
  assert.equal(row, '| Phone X | Basic (55) | 2.5 bpm | 30 ms | — |');
});

test('a rating that is not the Appendix B object is rejected', () => {
  const measured = { rating: 'Full', hrMaeBpm: null, intervalMaeMs: null, testedOn: null };
  assert.throws(() => rowOf(device({ status: 'measured', measured })), /must be \{ "score"/);
});

test('a pipe in a phone name is escaped', () => {
  assert.match(rowOf(device({ displayName: 'A|B' })), /^\| A\\\|B \|/);
});

const README = [
  '## Tested devices',
  '',
  'Generated from `packages/device-db/devices.json` by `npm run devices:table`.',
  '',
  '| old |',
  '| --- |',
  '',
  '## Privacy',
  '',
].join('\n');

test('only the table under the generated-by line is replaced', () => {
  assert.equal(replaceTable(README, '| new |'), README.replace('| old |\n| --- |', '| new |'));
});

test('a README without a table or a blank line after it is rejected', () => {
  assert.throws(() => replaceTable(README.replace('| old |\n| --- |\n', ''), '| new |'), /needs a table/);
  assert.throws(
    () => replaceTable(README.trimEnd().replace('\n\n## Privacy', ''), '| new |'),
    /needs a table/,
  );
});

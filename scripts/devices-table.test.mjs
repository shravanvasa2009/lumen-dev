import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTable, replaceTable } from './devices-table.mjs';

const device = (overrides) => ({
  displayName: 'Phone X',
  match: { platform: 'ios' },
  measured: { rating: null, hrMaeBpm: null, intervalMaeMs: null, testedOn: null },
  status: 'placeholder',
  ...overrides,
});

test('a placeholder phone shows no numbers', () => {
  const [, , row] = renderTable([device()]).split('\n');
  assert.equal(row, '| Phone X | — | — | — | Not tested yet |');
});

test('a measured phone shows its tier and errors', () => {
  const measured = { rating: 'Full', hrMaeBpm: 1.8, intervalMaeMs: 14, testedOn: '2026-10-20' };
  const [, , row] = renderTable([device({ status: 'measured', measured })]).split('\n');
  assert.equal(row, '| Phone X | Full | 1.8 bpm | 14 ms | tested 2026-10-20 |');
});

test('a measured Android phone stays camera unverified', () => {
  const measured = { rating: 'Basic', hrMaeBpm: 2.5, intervalMaeMs: 30, testedOn: null };
  const [, , row] = renderTable([
    device({ status: 'measured', match: { platform: 'android' }, measured }),
  ]).split('\n');
  assert.match(row, /\| camera unverified \|$/);
});

test('only the table under the generated-by line is replaced', () => {
  const readme = [
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
  const updated = replaceTable(readme, '| new |');
  assert.equal(updated, readme.replace('| old |\n| --- |', '| new |'));
});

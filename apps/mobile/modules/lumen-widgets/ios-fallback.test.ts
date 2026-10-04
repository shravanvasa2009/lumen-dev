import fs from 'node:fs';
import path from 'node:path';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import lockscreen from '@/i18n/lockscreen.json';
import tokens from '@/theme/tokens.json';

// The iOS widget's empty state (the gallery preview) keeps copies of the app's copy and two tokens in Swift;
// these must stay equal to the app's sources, as fallback-res.test.ts checks for Android.
const SWIFT = fs.readFileSync(
  path.join(__dirname, '..', '..', 'targets', 'widget', 'WidgetFallback.swift'),
  'utf8',
);

function swiftCopy(name: 'englishCopy' | 'spanishCopy'): Record<string, string> {
  const block = new RegExp(`let ${name} = FallbackCopy\\(([^)]*)\\)`).exec(SWIFT)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\w+): "([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

describe('iOS widget fallback copy', () => {
  it.each([
    ['englishCopy', lockscreen.en, en],
    ['spanishCopy', lockscreen.es, es],
  ] as const)('%s matches the app', (name, lock, appCopy) => {
    const { description, ...copy } = swiftCopy(name);
    expect(copy).toEqual({
      emptyTitle: lock['widget.empty.title'],
      emptyBody: lock['widget.empty.body'],
      checkNow: appCopy['widgets.checkNow'],
      fullScan: appCopy['mode.full'],
    });
    // WID-2: the gallery line names no value or condition.
    expect(description).toMatch(/\S/);
    expect(description).not.toMatch(/\d|bpm|AFib|PSVT|POTS|diabet/i);
  });

  it('uses the accent fill pair, which is the same in light and dark', () => {
    expect(tokens.light.accentFill).toBe(tokens.dark.accentFill);
    expect(tokens.light.onAccentFill).toBe(tokens.dark.onAccentFill);
    expect(SWIFT).toContain(`fallbackAccentFill = Color(hex: "${tokens.light.accentFill}")`);
    expect(SWIFT).toContain(`fallbackOnAccentFill = Color(hex: "${tokens.light.onAccentFill}")`);
  });
});

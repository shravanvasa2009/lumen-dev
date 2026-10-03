import fs from 'node:fs';
import path from 'node:path';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import lockscreen from '@/i18n/lockscreen.json';
import tokens from '@/theme/tokens.json';
import { PALETTE_KEYS } from '@/widgets/publish';

// The Android widget's fallback (before the app first publishes) keeps copies of tokens and copy in its
// res folder; these must stay equal to the app's sources.
const RES = path.join(__dirname, 'android', 'src', 'main', 'res');

function resourceValues(file: string, tag: 'color' | 'string'): Record<string, string> {
  const xml = fs.readFileSync(path.join(RES, file), 'utf8');
  const pattern = new RegExp(`<${tag} name="([a-z0-9_]+)">([^<]*)</${tag}>`, 'g');
  return Object.fromEntries(
    [...xml.matchAll(pattern)].map(([, name, value]) => [name, value!.replace(/\\'/g, "'")]),
  );
}

const snakeCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

describe('Android widget fallback resources', () => {
  it('holds the light and dark token colors', () => {
    const colors = resourceValues('values/lumen_widget_colors.xml', 'color');
    const expected = Object.fromEntries(
      (['light', 'dark'] as const).flatMap((theme) =>
        PALETTE_KEYS.map((key) => [`lumen_widget_${theme}_${snakeCase(key)}`, tokens[theme][key]]),
      ),
    );
    expect(colors).toEqual(expected);
  });

  it.each([
    ['values', lockscreen.en, en],
    ['values-es', lockscreen.es, es],
  ] as const)('holds the %s empty-state copy', (folder, lock, appCopy) => {
    expect(resourceValues(`${folder}/lumen_widget_strings.xml`, 'string')).toEqual({
      lumen_widget_empty_title: lock['widget.empty.title'],
      lumen_widget_empty_body: lock['widget.empty.body'],
      lumen_widget_check_now: appCopy['widgets.checkNow'],
      lumen_widget_full_scan: appCopy['mode.full'],
    });
  });
});

const REMOTE_VIEWS_TAGS = new Set(['FrameLayout', 'LinearLayout', 'ImageView', 'TextView', 'include']);

describe('Android widget picker', () => {
  it.each(['small', 'medium'])('gives the %s widget a description and a preview layout', (size) => {
    const provider = fs.readFileSync(path.join(RES, 'xml', `lumen_widget_${size}.xml`), 'utf8');
    expect(provider).toContain(`android:description="@string/lumen_widget_${size}_description"`);
    expect(provider).toContain(`android:previewLayout="@layout/lumen_widget_preview_${size}"`);
    expect(fs.existsSync(path.join(RES, 'layout', `lumen_widget_preview_${size}.xml`))).toBe(true);
  });

  // The picker inflates the preview as RemoteViews, which refuses any other class and shows "Couldn't add
  // widget" instead (a plain View did that on the API 37 emulator, 2026-10-03).
  // https://developer.android.com/develop/ui/views/appwidgets/layouts
  it.each(['small', 'medium', 'mark'])('draws the %s preview only with RemoteViews classes', (name) => {
    const layout = fs.readFileSync(path.join(RES, 'layout', `lumen_widget_preview_${name}.xml`), 'utf8');
    const tags = [...layout.matchAll(/<([A-Za-z]+)[\s/>]/g)].map(([, tag]) => tag);
    expect(tags.filter((tag) => !REMOTE_VIEWS_TAGS.has(tag!))).toEqual([]);
  });

  it('describes both widgets in English and Spanish', () => {
    const english = resourceValues('values/lumen_widget_picker_strings.xml', 'string');
    const spanish = resourceValues('values-es/lumen_widget_picker_strings.xml', 'string');
    expect(Object.keys(spanish)).toEqual(Object.keys(english));
    expect(Object.keys(english)).toEqual([
      'lumen_widget_small_description',
      'lumen_widget_medium_description',
    ]);
  });
});

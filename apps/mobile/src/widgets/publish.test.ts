import '@/i18n';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';

import { widgetDisplay } from './publish';
import type { WidgetStatus } from './snapshot';

const STATUSES: WidgetStatus[] = ['regular', 'check-again', 'see-doctor', 'inconclusive'];

// A lock-screen part is a whole lockscreen.json string or one side of a "Lumen · Status" string, so
// check-notification-copy.mjs has already screened it (WID-2).
function screenedParts(language: string): Set<string> {
  return new Set(
    Object.values(lockscreenStrings(language)).flatMap((text) => {
      const { name, status } = lockTextLines(text);
      return [text, name, status];
    }),
  );
}

describe('widgetDisplay lock-screen copy (WID-1, WID-2)', () => {
  it.each(['en', 'es'])(
    'builds the lock-screen name and statuses only from lockscreen.json (%s)',
    (language) => {
      const display = widgetDisplay(language);
      const screened = screenedParts(language);
      for (const part of [display.name, ...STATUSES.map((status) => display.status[status])]) {
        expect({ part, screened: screened.has(part) }).toEqual({ part, screened: true });
      }
    },
  );

  it.each(['en', 'es'])('says the same thing inline as on the rectangular widget (%s)', (language) => {
    const display = widgetDisplay(language);
    for (const status of STATUSES) {
      expect({ status, lines: lockTextLines(display.inline[status]) }).toEqual({
        status,
        lines: { name: display.name, status: display.status[status] },
      });
    }
  });

  it('passes the next-check template and the language through for Swift to fill in', () => {
    const display = widgetDisplay('es');
    expect(display.nextCheck).toBe(lockscreenStrings('es')['widget.lock.nextCheck']);
    expect(display.nextCheck).toContain('{{time}}');
    expect(display.language).toBe('es');
  });
});

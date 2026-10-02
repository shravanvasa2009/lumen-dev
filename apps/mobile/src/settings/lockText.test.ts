import { lockscreenStrings } from '@/i18n/lockscreen';

import { lockTextLines } from './lockText';

describe('lockTextLines', () => {
  it('splits a lock-screen string into the app name and the status', () => {
    expect(lockTextLines('Lumen · Check again tonight')).toEqual({
      name: 'Lumen',
      status: 'Check again tonight',
    });
  });

  it('splits every widget string in both languages into a name and a status', () => {
    for (const language of ['en', 'es']) {
      const strings = lockscreenStrings(language);
      for (const text of [strings['widget.lock.upToDate'], strings['widget.lock.checkAgain']]) {
        const { name, status } = lockTextLines(text);
        expect(name).toBe('Lumen');
        expect(status).not.toBe('');
      }
    }
  });
});

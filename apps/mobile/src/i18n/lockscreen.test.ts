import { lockscreenStrings } from './lockscreen';

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('lockscreenStrings', () => {
  const english = lockscreenStrings('en');
  const spanish = lockscreenStrings('es');

  it('has the same keys in English and Spanish', () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
  });

  it('keeps the same placeholders in each translation', () => {
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect({ key, slots: placeholders(spanish[key]) }).toEqual({ key, slots: placeholders(english[key]) });
    }
  });

  it('falls back to English for an unsupported language', () => {
    expect(lockscreenStrings('fr')).toBe(english);
    expect(lockscreenStrings('toString')).toBe(english);
  });

  it('reads the language from a regional tag', () => {
    expect(lockscreenStrings('es-MX')).toBe(spanish);
    expect(lockscreenStrings('EN-us')).toBe(english);
  });
});

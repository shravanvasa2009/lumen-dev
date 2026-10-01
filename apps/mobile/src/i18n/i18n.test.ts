import { getLocales } from 'expo-localization';

import { APP_NAME } from '../../app.config';

import en from './en.json';
import es from './es.json';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'es-MX' }]) }));

type I18next = typeof import('i18next').default;

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

function startWithDeviceTag(languageTag: string | undefined): I18next {
  jest
    .mocked(getLocales)
    .mockReturnValueOnce((languageTag ? [{ languageTag }] : []) as unknown as ReturnType<typeof getLocales>);
  let started: I18next | undefined;
  jest.isolateModules(() => {
    jest.requireActual('./index');
    const i18nextModule = jest.requireActual<I18next & { default?: I18next }>('i18next');
    started = i18nextModule.default ?? i18nextModule;
  });
  if (!started) throw new Error('i18n module did not load');
  return started;
}

describe('en.json and es.json', () => {
  it('have the same keys', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('keep the same placeholders in each translation', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect({ key, slots: placeholders(es[key]) }).toEqual({ key, slots: placeholders(en[key]) });
    }
  });

  it('keep the app name equal to APP_NAME in app.config.ts', () => {
    expect(en['app.name']).toBe(APP_NAME);
    expect(es['app.name']).toBe(APP_NAME);
  });
});

describe('i18n initialisation', () => {
  it('uses Spanish for a regional Spanish device tag', () => {
    expect(startWithDeviceTag('es-MX').t('app.tagline')).toBe(es['app.tagline']);
  });

  it('uses English for an English device tag in any case', () => {
    expect(startWithDeviceTag('EN-us').t('app.tagline')).toBe(en['app.tagline']);
  });

  it('uses English for an unsupported device language', () => {
    expect(startWithDeviceTag('fr-FR').t('app.tagline')).toBe(en['app.tagline']);
  });

  it('does not treat an Object.prototype name as a language', () => {
    expect(startWithDeviceTag('toString').t('app.tagline')).toBe(en['app.tagline']);
  });

  it('uses English when the device reports no locale', () => {
    expect(startWithDeviceTag(undefined).t('app.tagline')).toBe(en['app.tagline']);
  });

  it('falls back to English for a key only English has', () => {
    const i18next = startWithDeviceTag('es-MX');
    i18next.addResource('en', 'translation', 'test.onlyEnglish', 'English only');
    expect(i18next.t('test.onlyEnglish')).toBe('English only');
  });
});

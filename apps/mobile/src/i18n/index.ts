import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import es from './es.json';

const resources = { en: { translation: en }, es: { translation: es } };

// Accepts a bare language or a regional tag (es-MX reads as es). The own-key check keeps names like
// "toString" from Object.prototype from counting as a language.
function resolveLanguage(languageTag: string | null | undefined): keyof typeof resources {
  const language = languageTag?.split('-')[0]?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(resources, language)
    ? (language as keyof typeof resources)
    : 'en';
}

// Keys are flat dotted names from Appendix C, so nesting by "." is switched off. Resources are bundled,
// so init finishes synchronously and no screen renders before strings exist. A rejection is not caught
// here on purpose: React Native reports unhandled rejections (red box in development), and there is no
// fallback that could recover from missing strings.
void i18next.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(getLocales()[0]?.languageTag),
  fallbackLng: 'en',
  keySeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
});

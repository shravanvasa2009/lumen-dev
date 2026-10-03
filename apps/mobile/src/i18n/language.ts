import i18next from 'i18next';
import { useEffect } from 'react';

import { resyncNotifications } from '@/settings/applyPrefs';
import { profileValue, setProfileValue } from '@/store/profile';

const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

const PROFILE_KEY = 'language';

const isLanguage = (value: string | null): value is Language => LANGUAGES.some((code) => code === value);

// The language applies at once; saving it can fail, and the caller shows that, because the choice would
// then be lost on the next launch. Demo mode writes nothing (§8.5), so a demo choice lasts the session.
export async function chooseLanguage(code: Language): Promise<void> {
  await i18next.changeLanguage(code);
  await setProfileValue(PROFILE_KEY, code);
}

// Until a choice is saved the device language stays (see ./index). A failed read keeps the device language
// too; the screens that need saved data report their own storage errors. The launch re-sync of reminders
// follows, so their text is planned in the language the person chose. A sync missed in the background (app
// closed, failure) is repaired here at the next launch.
export function useSavedLanguage(): void {
  useEffect(() => {
    void profileValue(PROFILE_KEY)
      .then((saved) => (isLanguage(saved) ? i18next.changeLanguage(saved) : undefined))
      .catch(() => undefined)
      .then(() => resyncNotifications());
  }, []);
}

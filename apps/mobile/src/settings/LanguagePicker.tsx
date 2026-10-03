import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { chooseLanguage, type Language } from '@/i18n/language';

import { resyncNotifications } from './applyPrefs';

import { Segmented } from './Segmented';

export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const [saveFailed, setSaveFailed] = useState(false);
  const [remindersFailed, setRemindersFailed] = useState(false);

  async function pick(code: Language) {
    setSaveFailed(false);
    setRemindersFailed(false);
    try {
      await chooseLanguage(code);
    } catch {
      setSaveFailed(true);
      return;
    }
    try {
      await resyncNotifications(code);
    } catch {
      setRemindersFailed(true);
    }
  }

  return (
    <Card>
      <Segmented
        label={t('language.label')}
        selected={i18n.language === 'es' ? 'es' : 'en'}
        onSelect={(code) => void pick(code)}
        options={[
          { value: 'en', label: t('language.en') },
          { value: 'es', label: t('language.es') },
        ]}
      />
      {remindersFailed ? (
        <AppText accessibilityRole="alert">{t('settings.languageRemindersFailed')}</AppText>
      ) : null}
      {saveFailed ? <AppText accessibilityRole="alert">{t('settings.languageNotSaved')}</AppText> : null}
    </Card>
  );
}

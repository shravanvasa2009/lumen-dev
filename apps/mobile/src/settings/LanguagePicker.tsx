import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { chooseLanguage, type Language } from '@/i18n/language';

import { Segmented } from './Segmented';

export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const [saveFailed, setSaveFailed] = useState(false);

  async function pick(code: Language) {
    setSaveFailed(false);
    try {
      await chooseLanguage(code);
    } catch {
      setSaveFailed(true);
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
      {saveFailed ? <AppText accessibilityRole="alert">{t('settings.languageNotSaved')}</AppText> : null}
    </Card>
  );
}

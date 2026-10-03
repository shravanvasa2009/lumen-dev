import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

export function AboutCard() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card>
      <AppText variant="headline">{t('app.name')}</AppText>
      <AppText tone="textDim">
        {t('settings.aboutVersion', { version: Constants.expoConfig?.version ?? '' })}
      </AppText>
      <AppText>{t('prototype.banner')}</AppText>
      <AppText tone="textDim">{t('settings.aboutBody')}</AppText>
      <Button
        label={t('settings.aboutAccuracy')}
        variant="secondary"
        onPress={() => router.push('/settings/accuracy')}
      />
    </Card>
  );
}

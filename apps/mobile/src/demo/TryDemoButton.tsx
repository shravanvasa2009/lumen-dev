import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';

import { enterDemo } from './demoSession';

export function TryDemoButton() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Button
      label={t('welcome.tryDemo')}
      variant="secondary"
      onPress={() => {
        enterDemo();
        router.replace('/');
      }}
    />
  );
}

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';

import { useStartDemo } from './useStartDemo';

export function TryDemoButton() {
  const { t } = useTranslation();
  const startDemo = useStartDemo();
  return <Button label={t('welcome.tryDemo')} variant="secondary" onPress={startDemo} />;
}

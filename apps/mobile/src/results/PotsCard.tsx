import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

import { CheckHeading } from './CheckHeading';

// POTS is measured only by the Standing test (ADR 0082), so every scan says so and points to it.
export function PotsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card>
      <CheckHeading icon="standing" name={t('checks.pots.name')} label={t('results.potsLabel')} />
      <AppText variant="headline">{t('results.notThisScan')}</AppText>
      <Button
        variant="secondary"
        label={t('results.takeStanding')}
        onPress={() => router.push('/measure/standing-test')}
      />
    </Card>
  );
}

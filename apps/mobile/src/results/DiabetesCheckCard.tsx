import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { evidenceFor } from '@/evidence';
import { useTheme } from '@/theme';

import { CheckHeading } from './CheckHeading';

// ADR 0082: the diabetes check has its own card while its model is Experimental. It is never flagged,
// and the pill comes from the evidence reader; tapping it explains the label in one sentence.
export function DiabetesCheckCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const [explaining, setExplaining] = useState(false);
  const explainable = evidenceFor('diabetes').label === 'experimental';
  const pill = <EvidenceBadge metric="diabetes" />;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <CheckHeading icon="drop" name={t('checks.diabetes.name')} label={t('results.notDiabetesTest')} />
        {explainable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('results.whatExperimentalMeans')}
            hitSlop={spacing.md}
            onPress={() => setExplaining(true)}
          >
            {pill}
          </Pressable>
        ) : (
          pill
        )}
      </View>
      <AppText variant="title">{t('results.pulsePattern')}</AppText>
      <AppText tone="textDim">{t('dm.experimental')}</AppText>
      <BottomSheet visible={explaining} onDismiss={() => setExplaining(false)} dismissLabel={t('common.close')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {pill}
          <AppText variant="headline">{t('checks.diabetes.name')}</AppText>
        </View>
        <AppText>{t('evidence.experimental.explain')}</AppText>
        <AppText tone="textDim">{t('dm.experimental')}</AppText>
        <AppText
          accessibilityRole="link"
          tone="accent"
          onPress={() => {
            setExplaining(false);
            router.push('/settings/accuracy');
          }}
        >
          {t('results.accuracy')} ›
        </AppText>
        <Button label={t('common.gotIt')} onPress={() => setExplaining(false)} />
      </BottomSheet>
    </Card>
  );
}

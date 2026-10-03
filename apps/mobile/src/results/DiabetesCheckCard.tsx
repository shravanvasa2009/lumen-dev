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

// ADR 0082: the diabetes check has its own card while its model is Experimental. It is never flagged,
// and the pill comes from the evidence reader; tapping it explains the label in one sentence.
export function DiabetesCheckCard() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [explaining, setExplaining] = useState(false);
  const explainable = evidenceFor('diabetes').label === 'experimental';
  const pill = <EvidenceBadge metric="diabetes" />;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexShrink: 1 }}>
          <AppText variant="headline">{t('checks.diabetes.name')}</AppText>
          <AppText tone="textDim">· {t('results.notDiabetesTest')}</AppText>
        </View>
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
      <BottomSheet visible={explaining} onDismiss={() => setExplaining(false)} dismissLabel={t('safety.dismiss')}>
        <AppText variant="headline">{t('evidence.experimental')}</AppText>
        <AppText>{t('evidence.experimental.explain')}</AppText>
        <Button label={t('common.gotIt')} onPress={() => setExplaining(false)} />
      </BottomSheet>
    </Card>
  );
}

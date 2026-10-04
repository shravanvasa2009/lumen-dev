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
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

// ADR 0082, 0090: while its model is Experimental the pulse pattern is an extra under the questionnaire
// result, with no number. It is never flagged, and the pill comes from the evidence reader; tapping it
// explains the label in one sentence.
export function DiabetesCheckCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const [explaining, setExplaining] = useState(false);
  const explainable = evidenceFor('diabetes').label === 'experimental';
  const pill = <EvidenceBadge metric="diabetes" />;
  return (
    <View testID="pulse-extra" style={{ gap: spacing.sm }}>
      <SectionLabel>{t('dr.pulseExtra')}</SectionLabel>
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <AppText variant="title" style={{ flexShrink: 1 }}>
            {t('results.pulsePattern')}
          </AppText>
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
        <AppText tone="textDim">
          {t('dm.experimental')} {t('dr.notInScore')}
        </AppText>
        <BottomSheet
          visible={explaining}
          onDismiss={() => setExplaining(false)}
          dismissLabel={t('common.close')}
        >
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
    </View>
  );
}

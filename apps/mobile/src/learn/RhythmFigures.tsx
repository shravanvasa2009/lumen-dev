import { useTranslation } from 'react-i18next';

import { formatPercent } from '@/accuracy/format';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';

import { bundledRhythmFigures } from './rhythmEvidence';

export function RhythmFigures() {
  const { t, i18n } = useTranslation();
  const { falseAfRate, readingAbstainRate } = bundledRhythmFigures;
  return (
    <Card>
      {falseAfRate === null ? (
        <>
          <AppText>{t('learn.rhythmExtraBeatsNote')}</AppText>
          <AppText tone="textDim">{t('evidence.notTested')}</AppText>
        </>
      ) : (
        <AppText>{t('learn.rhythmFalseAf', { rate: formatPercent(falseAfRate, i18n.language) })}</AppText>
      )}
      {readingAbstainRate === null ? (
        <>
          <AppText>{t('learn.rhythmAbstainLabel')}</AppText>
          <AppText tone="textDim">{t('evidence.notTested')}</AppText>
        </>
      ) : (
        <AppText>
          {t('learn.rhythmAbstain', { rate: formatPercent(readingAbstainRate, i18n.language) })}
        </AppText>
      )}
    </Card>
  );
}

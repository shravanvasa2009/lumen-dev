import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatPercent } from '@/accuracy/format';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { IconTile } from '@/settings/IconTile';
import { useTheme } from '@/theme';

import { bundledRhythmFigures } from './rhythmEvidence';

export function RhythmFigures() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const { falseAfRate, readingAbstainRate, source } = bundledRhythmFigures;
  const figuresShown = falseAfRate !== null || readingAbstainRate !== null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <IconTile name="bars" neutral />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <AppText variant="headline" accessibilityRole="header">
            {t('learn.rhythmTestingHeading')}
          </AppText>
          {falseAfRate === null ? (
            <>
              <AppText variant="subheadline">{t('learn.rhythmExtraBeatsNote')}</AppText>
              <AppText variant="subheadline" tone="textDim">
                {t('evidence.notTested')}
              </AppText>
            </>
          ) : (
            <AppText variant="subheadline">
              {t('learn.rhythmFalseAf', { rate: formatPercent(falseAfRate, i18n.language) })}
            </AppText>
          )}
          {readingAbstainRate === null ? (
            <>
              <AppText variant="subheadline">{t('learn.rhythmAbstainLabel')}</AppText>
              <AppText variant="subheadline" tone="textDim">
                {t('evidence.notTested')}
              </AppText>
            </>
          ) : (
            <AppText variant="subheadline">
              {t('learn.rhythmAbstain', { rate: formatPercent(readingAbstainRate, i18n.language) })}
            </AppText>
          )}
          {figuresShown ? (
            <AppText variant="caption" tone="textDim">
              {source === null ? t('learn.rhythmSourceFallback') : t('learn.rhythmSource', { source })}
            </AppText>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { intervalAxis } from './axis';
import { BeatStrip } from './BeatStrip';
import { PoincarePlot } from './PoincarePlot';

const STEP_GAPS = 4;

type RhythmMapSheetProps = {
  visible: boolean;
  onClose: () => void;
  intervalsMs: readonly number[];
  color: string;
};

function Step({
  number,
  title,
  body,
  children,
}: {
  number: number;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.badgeCheckedBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText variant="caption" style={{ color: colors.badgeCheckedFg, fontWeight: '700' }}>
          {number}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <AppText variant="headline">{title}</AppText>
        <AppText tone="textDim">{body}</AppText>
        {children}
      </View>
    </View>
  );
}

// Three steps from the person's own first beats: time the gaps, pair each gap with the next, plot one dot per pair.
export function RhythmMapSheet({ visible, onClose, intervalsMs, color }: RhythmMapSheetProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const gaps = intervalsMs.slice(0, STEP_GAPS);
  return (
    <BottomSheet visible={visible} onDismiss={onClose} dismissLabel={t('common.close')} appearance="grouped">
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.lg }}>
        <AppText variant="title3" accessibilityRole="header">
          {t('why.howMapMade')}
        </AppText>
        <Step number={1} title={t('why.stepTimeTitle')} body={t('why.stepTimeBody')}>
          <BeatStrip intervalsMs={gaps} color={color} />
        </Step>
        <Step number={2} title={t('why.stepPairTitle')} body={t('why.stepPairBody')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {gaps.slice(0, -1).map((gap, index) => (
              <View
                key={index}
                style={{
                  backgroundColor: colors.surface2,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <AppText variant="caption">{`${Math.round(gap)} → ${Math.round(gaps[index + 1] ?? gap)}`}</AppText>
              </View>
            ))}
          </View>
        </Step>
        <Step number={3} title={t('why.stepDotTitle')} body={t('why.stepDotBody')}>
          <View style={{ width: 140 }}>
            <PoincarePlot
              intervalsMs={intervalsMs}
              axis={intervalAxis(intervalsMs)}
              color={color}
              label={t('why.rhythmMap')}
            />
          </View>
        </Step>
      </ScrollView>
      <Button label={t('common.gotIt')} onPress={onClose} />
    </BottomSheet>
  );
}

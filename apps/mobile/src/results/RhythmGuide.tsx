import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { RhythmClass } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { intervalAxis } from './axis';
import { regularIntervalsMs } from './fixtures';
import { PoincarePlot } from './PoincarePlot';

// Drawn pictures of the three shapes a rhythm map can take. They are examples, not the person's beats.
const STEADY = regularIntervalsMs;
const EXTRA_BEATS = regularIntervalsMs.map((gap, index) =>
  index % 9 === 4 ? 640 : index % 9 === 5 ? 1220 : gap,
);
const IRREGULAR = [
  750, 985, 620, 930, 700, 1000, 580, 845, 640, 950, 550, 810, 590, 940, 690, 865, 720, 985, 660, 900, 770,
  620, 975, 700, 830, 560, 910, 650, 880, 730, 995, 600, 850, 680, 960, 610, 790, 700, 925, 640,
];
const AXIS = intervalAxis([...STEADY, ...EXTRA_BEATS, ...IRREGULAR]);

type Shape = 'steady' | 'extra' | 'irregular';

// Which example the reading's own map resembles; a map that was not judged highlights none.
function yoursFor(rhythmClass: RhythmClass | null): Shape | null {
  if (rhythmClass === null) return null;
  return rhythmClass === 'sinus' ? 'steady' : 'irregular';
}

export function RhythmGuide({ rhythmClass }: { rhythmClass: RhythmClass | null }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const yours = yoursFor(rhythmClass);
  const shapes: { shape: Shape; gaps: readonly number[]; title: string; note: string }[] = [
    { shape: 'steady', gaps: STEADY, title: t('why.guideSteady'), note: t('why.guideSteadyNote') },
    { shape: 'extra', gaps: EXTRA_BEATS, title: t('why.guideExtra'), note: t('why.guideExtraNote') },
    {
      shape: 'irregular',
      gaps: IRREGULAR,
      title: t('why.guideIrregular'),
      note: t('why.guideIrregularNote'),
    },
  ];
  return (
    <View accessibilityLabel={t('why.guideExamples')} style={{ flexDirection: 'row', gap: spacing.md }}>
      {shapes.map(({ shape, gaps, title, note }) => {
        const mine = shape === yours;
        return (
          <View key={shape} style={{ flex: 1, minWidth: 0 }}>
            <View
              style={{
                borderWidth: 2.5,
                borderColor: mine ? colors.accent : 'transparent',
                borderRadius: 19,
                padding: 2.5,
              }}
            >
              <PoincarePlot intervalsMs={gaps} axis={AXIS} color={colors.accentFill} label={title} />
              {mine ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 9,
                    top: 9,
                    backgroundColor: colors.badgeCheckedBg,
                    borderRadius: 9,
                    paddingHorizontal: 7,
                  }}
                >
                  <AppText variant="caption2" style={{ color: colors.badgeCheckedFg }}>
                    {t('why.guideYours')}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText
              variant="subheadline"
              style={{ marginTop: spacing.md, fontWeight: '600', color: mine ? colors.accent : colors.text }}
            >
              {title}
            </AppText>
            <AppText variant="caption" tone="textDim" style={{ marginTop: 2 }}>
              {note}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

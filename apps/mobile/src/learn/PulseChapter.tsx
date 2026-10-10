import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { ChapterFrame, SectionText, TileRow } from './ChapterParts';
import type { Lesson } from './lessons';
import { BeatComparison, FingertipHero, JitterChip, LightToBeats, SignalCompare } from './PulseFigures';

const blurIcons = ['hand', 'press', 'cold'] as const;

export function PulseChapter({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [vessels, camera, blur] = lesson.template.sections;
  const blurChips = blur?.chips?.items(t) ?? [];
  return (
    <ChapterFrame lesson={lesson}>
      <FingertipHero />
      {vessels ? <SectionText heading={vessels.heading(t)} body={vessels.body(t)} /> : null}
      <BeatComparison />
      {camera ? <SectionText heading={camera.heading(t)} body={camera.body(t)} /> : null}
      <LightToBeats>
        <TileRow
          tone="teal"
          background="tint"
          solid
          tiles={[
            { icon: 'heart', label: t('learn.ch1.countsBeats') },
            { icon: 'timer', label: t('learn.ch1.measuresGaps') },
          ]}
        />
      </LightToBeats>
      {blur ? (
        <SectionText heading={blur.heading(t)} body={blur.body(t)}>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" style={{ color: colors.textDim, fontWeight: '600' }}>
              {blur.chips?.label?.(t)}
            </AppText>
            <TileRow
              tone="amber"
              background="card"
              tiles={blurChips.map((label, index) => ({
                icon: blurIcons[index] ?? 'hand',
                label,
                extra: <JitterChip seed={11 + index * 13} />,
              }))}
            />
          </View>
        </SectionText>
      ) : null}
      <SignalCompare />
    </ChapterFrame>
  );
}

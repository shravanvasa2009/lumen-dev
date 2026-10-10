import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { BloodTestCard, LinkedPatternCard, PulseWaveHero, VesselChain } from './DiabetesFigures';
import { ChapterFrame, SectionText, TileRow } from './ChapterParts';
import type { Lesson } from './lessons';

const alsoIcons = ['age', 'cold', 'medicine'] as const;

export function DiabetesChapter({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [vessels, pattern, bloodTest] = lesson.template.sections;
  const also = pattern?.chips?.items(t) ?? [];
  return (
    <ChapterFrame lesson={lesson}>
      <PulseWaveHero />
      {vessels ? <SectionText heading={vessels.heading(t)} body={vessels.body(t)} /> : null}
      <VesselChain />
      {pattern ? (
        <SectionText heading={pattern.heading(t)} body={pattern.body(t)}>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" style={{ color: colors.textDim, fontWeight: '600' }}>
              {pattern.chips?.label?.(t)}
            </AppText>
            <TileRow
              tone="amber"
              background="card"
              tiles={also.map((label, index) => ({ icon: alsoIcons[index] ?? 'age', label }))}
            />
          </View>
        </SectionText>
      ) : null}
      <LinkedPatternCard />
      {bloodTest ? <SectionText heading={bloodTest.heading(t)} body={bloodTest.body(t)} /> : null}
      <BloodTestCard />
    </ChapterFrame>
  );
}

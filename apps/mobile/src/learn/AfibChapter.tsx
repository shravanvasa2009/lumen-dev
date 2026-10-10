import { useTranslation } from 'react-i18next';

import type { Lesson } from './lessons';
import { ChapterFrame, SectionText } from './ChapterParts';
import { DayOfReadings, FirstStepTiles, RhythmTraces, SilentCard, StrokeRiskCard } from './AfibFigures';

export function AfibChapter({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const [what, early, possible, one] = lesson.template.sections;
  return (
    <ChapterFrame lesson={lesson}>
      <RhythmTraces />
      {what ? <SectionText heading={what.heading(t)} body={what.body(t)} /> : null}
      <SilentCard />
      {early ? <SectionText heading={early.heading(t)} body={early.body(t)} /> : null}
      <StrokeRiskCard />
      {possible ? <SectionText heading={possible.heading(t)} body={possible.body(t)} /> : null}
      <DayOfReadings />
      {one ? (
        <SectionText heading={one.heading(t)} body={one.body(t)}>
          <FirstStepTiles />
        </SectionText>
      ) : null}
    </ChapterFrame>
  );
}

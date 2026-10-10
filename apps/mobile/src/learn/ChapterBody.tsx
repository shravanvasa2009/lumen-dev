import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { ChapterFrame, SectionText } from './ChapterParts';
import {
  BookAVisitSignals,
  DoctorEmergency,
  HealthCenterLink,
  ReportPreview,
  ScreeningFlow,
  TriageLadder,
} from './DoctorFigures';
import {
  AccuracyLink,
  HigherAndLowerCards,
  HrvHero,
  HrvOverWeeks,
  MetronomeVersusHeart,
  YourUsualBand,
} from './HrvFigures';
import type { Lesson } from './lessons';
import { CanAndCannot, LightWaveVersusEcg, LimitsEmergency, LimitsHero } from './LimitsFigures';

type ChapterLayout = {
  // Drawn above the first section; when it is a hero card it also holds that section's words.
  hero?: (props: { children: ReactNode }) => ReactNode;
  lead?: ReactNode;
  // Pictures set after the section at the same index, in order.
  after: Readonly<Record<number, readonly ReactNode[]>>;
};

type LessonChapter = 'hrv' | 'limits' | 'doctor';

const layouts: Readonly<Record<LessonChapter, ChapterLayout>> = {
  hrv: {
    hero: HrvHero,
    after: {
      0: [<MetronomeVersusHeart key="strips" />],
      1: [<HigherAndLowerCards key="causes" />, <HrvOverWeeks key="weeks" />],
      2: [<YourUsualBand key="band" />],
      3: [<AccuracyLink key="accuracy" />],
    },
  },
  limits: {
    hero: LimitsHero,
    after: {
      1: [<CanAndCannot key="can" />, <LightWaveVersusEcg key="why" />],
      2: [<LimitsEmergency key="emergency" />],
    },
  },
  doctor: {
    lead: <TriageLadder />,
    after: {
      0: [<ScreeningFlow key="flow" />],
      1: [<DoctorEmergency key="emergency" />],
      2: [<BookAVisitSignals key="signals" />],
      3: [<ReportPreview key="report" />],
      4: [<HealthCenterLink key="finder" />],
    },
  },
};

// Chapters 6 to 8: each section's heading and paragraph, with the mockup's pictures between them.
function ChapterBody({ chapter, lesson }: { chapter: LessonChapter; lesson: Lesson }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const layout = layouts[chapter];
  return (
    <ChapterFrame lesson={lesson}>
      {layout.lead ?? null}
      {lesson.template.sections.map((section, index) => {
        const words = <SectionText heading={section.heading(t)} body={section.body(t)} />;
        const Hero = index === 0 ? layout.hero : undefined;
        return (
          <View key={section.heading(t)} style={{ gap: spacing.lg }}>
            {Hero ? <Hero>{words}</Hero> : words}
            {layout.after[index] ?? null}
          </View>
        );
      })}
    </ChapterFrame>
  );
}

export function HrvChapter({ lesson }: { lesson: Lesson }) {
  return <ChapterBody chapter="hrv" lesson={lesson} />;
}

export function LimitsChapter({ lesson }: { lesson: Lesson }) {
  return <ChapterBody chapter="limits" lesson={lesson} />;
}

export function DoctorChapter({ lesson }: { lesson: Lesson }) {
  return <ChapterBody chapter="doctor" lesson={lesson} />;
}

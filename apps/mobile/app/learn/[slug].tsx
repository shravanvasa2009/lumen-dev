import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { LessonTemplateView } from '@/learn/LessonTemplateView';
import { lessons } from '@/learn/lessons';
import { RhythmFigures } from '@/learn/RhythmFigures';

export default function LessonScreen() {
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const lesson = lessons.find((candidate) => candidate.slug === slug);
  if (!lesson) return <RouteShell title={t('learn.notFound')} />;
  return (
    <RouteShell title={lesson.title(t)} subtitle={lesson.length(t)}>
      {lesson.illustration ? (
        <Card>
          <AppText tone="textDim">{lesson.illustration(t)}</AppText>
        </Card>
      ) : null}
      {'template' in lesson ? (
        <LessonTemplateView lesson={lesson} template={lesson.template} />
      ) : (
        <>
          {lesson.body(t).map((paragraph) => (
            <AppText key={paragraph}>{paragraph}</AppText>
          ))}
          {lesson.showsRhythmFigures ? <RhythmFigures /> : null}
        </>
      )}
    </RouteShell>
  );
}

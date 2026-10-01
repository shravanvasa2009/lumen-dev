import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { lessons } from '@/learn/lessons';

export default function LessonScreen() {
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const lesson = lessons.find((candidate) => candidate.slug === slug);
  return <RouteShell title={lesson ? lesson.title(t) : t('learn.notFound')} />;
}

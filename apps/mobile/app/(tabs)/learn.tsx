import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { lessons } from '@/learn/lessons';

export default function LearnScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <RouteShell title={t('learn.title')}>
      {lessons.map((lesson) => (
        <ListRow
          key={lesson.slug}
          title={lesson.title(t)}
          onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: lesson.slug } })}
        />
      ))}
      <AppText variant="caption" tone="textDim">
        {t('learn.offline')}
      </AppText>
    </RouteShell>
  );
}

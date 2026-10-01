import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { lessons } from '@/learn/lessons';

export default function LearnScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <RouteShell tabRoot title={t('learn.title')}>
      <Card flush>
        {lessons.map((lesson, index) => (
          <ListRow
            key={lesson.slug}
            last={index === lessons.length - 1}
            title={lesson.title(t)}
            onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: lesson.slug } })}
          />
        ))}
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('learn.offline')}
      </AppText>
    </RouteShell>
  );
}

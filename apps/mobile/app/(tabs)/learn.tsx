import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { LanguageToggle } from '@/learn/LanguageToggle';
import { LessonTile } from '@/learn/LessonTile';
import { lessons } from '@/learn/lessons';
import { useTheme } from '@/theme';

// Spec 8.4: HRSA's finder, kept as the web option beside the Care map and opened only when tapped.
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';

export default function LearnScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  return (
    <RouteShell tabRoot title={t('learn.title')} trailing={<LanguageToggle />}>
      <Card flush>
        {lessons.map((lesson) => (
          <ListRow
            key={lesson.slug}
            leading={<LessonTile tone={lesson.tone} />}
            title={lesson.title(t)}
            subtitle={lesson.length(t)}
            chevron
            onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: lesson.slug } })}
          />
        ))}
        <ListRow
          last
          chevron
          leading={<LessonTile tone="accent" />}
          title={t('learn.careFinder')}
          subtitle={t('learn.careFinderHint')}
          onPress={() => router.push('/care')}
        />
      </Card>
      <Pressable
        accessibilityRole="link"
        hitSlop={spacing.md}
        onPress={() => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true))}
      >
        <AppText tone="accent">{t('learn.careFinderWeb')}</AppText>
      </Pressable>
      {careFinderFailed ? <AppText tone="textDim">{t('learn.careFinderFailed')}</AppText> : null}
      <AppText variant="caption" tone="textDim">
        {t('learn.offline')}
      </AppText>
    </RouteShell>
  );
}

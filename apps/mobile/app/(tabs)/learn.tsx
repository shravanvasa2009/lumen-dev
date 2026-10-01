import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LanguageToggle } from '@/learn/LanguageToggle';
import { LessonRow } from '@/learn/LessonRow';
import { lessons } from '@/learn/lessons';
import { useTheme } from '@/theme';

// Spec 8.4: the only outbound link in the app, opened only when the user taps it.
const CARE_FINDER_URL = 'https://findahealthcenter.hrsa.gov';

export default function LearnScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [careFinderFailed, setCareFinderFailed] = useState(false);
  const { spacing } = useTheme();
  return (
    <Screen headerless>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={styles.titleRow}>
          <AppText variant="display" accessibilityRole="header">
            {t('learn.title')}
          </AppText>
          <LanguageToggle />
        </View>
        <Card flush>
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.slug}
              title={lesson.title(t)}
              subtitle={lesson.length(t)}
              tone={lesson.tone}
              last={false}
              onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: lesson.slug } })}
            />
          ))}
          <LessonRow
            last
            tone="accent"
            title={t('learn.careFinder')}
            subtitle={t('learn.careFinderHint')}
            onPress={() => Linking.openURL(CARE_FINDER_URL).catch(() => setCareFinderFailed(true))}
          />
        </Card>
        {careFinderFailed ? <AppText tone="textDim">{t('learn.careFinderFailed')}</AppText> : null}
        <AppText variant="caption" tone="textDim">
          {t('learn.offline')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

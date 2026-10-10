import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LumenMark } from '@/settings/LumenMark';
import { useTheme } from '@/theme';

import { lessons, totalMinutes } from './lessons';
import type { ReadProgress } from './readProgress';

const COVER_WIDTH = 140;
const COVER_HEIGHT = 192;
const SPINE_WIDTH = 8;
const BAR_HEIGHT = 4;
// The white page peeks out behind the cover to the lower right.
const PAGE_OFFSET = 5;

// The chapter to carry on with: the first one not read to the end, or the first one when all are done.
function continueIndex(progress: ReadProgress): number {
  const unfinished = lessons.findIndex((lesson) => (progress[lesson.slug] ?? 0) < 100);
  return unfinished === -1 ? 0 : unfinished;
}

export function GuideCard({ progress }: { progress: ReadProgress }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, shadow, spacing } = useTheme();
  const index = continueIndex(progress);
  const chapter = lessons[index]!;
  const percent = progress[chapter.slug] ?? 0;
  const allRead = lessons.every((lesson) => (progress[lesson.slug] ?? 0) >= 100);
  const action = allRead
    ? t('learn.readAgain')
    : percent > 0
      ? t('learn.continueReading')
      : t('learn.startReading');
  const shownPercent = allRead ? 100 : percent;
  return (
    <View style={{ borderRadius: radius.sheet, backgroundColor: colors.surface, ...shadow.raised }}>
      <View style={{ borderRadius: radius.sheet, overflow: 'hidden' }}>
        <View
          style={{
            height: COVER_HEIGHT + spacing.xxl,
            backgroundColor: colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: COVER_WIDTH + PAGE_OFFSET, height: COVER_HEIGHT + PAGE_OFFSET }}>
            <View
              style={{
                position: 'absolute',
                left: PAGE_OFFSET,
                top: PAGE_OFFSET,
                width: COVER_WIDTH,
                height: COVER_HEIGHT,
                borderTopLeftRadius: 4,
                borderBottomLeftRadius: 4,
                borderTopRightRadius: radius.card - 8,
                borderBottomRightRadius: radius.card - 8,
                backgroundColor: colors.surface,
              }}
            />
            <View
              accessible
              accessibilityLabel={t('learn.guideTitle')}
              style={{
                width: COVER_WIDTH,
                height: COVER_HEIGHT,
                borderTopLeftRadius: 4,
                borderBottomLeftRadius: 4,
                borderTopRightRadius: radius.card - 8,
                borderBottomRightRadius: radius.card - 8,
                backgroundColor: colors.buttonFill,
                overflow: 'hidden',
                padding: spacing.lg,
                justifyContent: 'space-between',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: SPINE_WIDTH,
                  backgroundColor: colors.scrim,
                  opacity: 0.2,
                }}
              />
              <LumenMark size={36} color={colors.onButtonFill} />
              <View style={{ gap: spacing.xs }}>
                <AppText variant="headline" style={{ color: colors.onButtonFill }}>
                  {t('learn.guideTitle')}
                </AppText>
                <AppText variant="caption" style={{ color: colors.onButtonFill, fontWeight: '600' }}>
                  {t('learn.guideMeta', { count: lessons.length, minutes: totalMinutes })}
                </AppText>
              </View>
            </View>
          </View>
        </View>
        <View style={{ padding: spacing.lg, gap: spacing.xs }}>
          <AppText variant="headline">{chapter.title(t)}</AppText>
          <AppText variant="caption" tone="textDim">
            {allRead
              ? t('learn.allRead', { total: lessons.length })
              : t('learn.chapterProgress', { n: index + 1, total: lessons.length, percent })}
          </AppText>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('learn.bookProgress')}
            accessibilityValue={{ min: 0, max: 100, now: shownPercent }}
            style={{
              marginTop: spacing.md,
              marginBottom: spacing.lg,
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: colors.surface3,
              overflow: 'hidden',
            }}
          >
            <View
              style={{ width: `${shownPercent}%`, height: BAR_HEIGHT, backgroundColor: colors.buttonFill }}
            />
          </View>
          <Button
            label={action}
            onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: chapter.slug } })}
          />
        </View>
      </View>
    </View>
  );
}

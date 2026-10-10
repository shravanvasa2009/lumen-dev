import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

import { lessonLength, lessons, type Lesson } from './lessons';
import { RhythmFigures } from './RhythmFigures';
import { RhythmGapPanels } from './RhythmGapPanels';
import { RhythmHero } from './RhythmHero';
import { ExtraBeatMapPair, RhythmMapPair } from './RhythmMapPanels';
import { useReadProgress } from './useReadProgress';

const NEXT_NUMBER_SIZE = 44;
const PROGRESS_HEIGHT = 4;
const CAUSE_ICONS: readonly IconName[] = ['standing', 'finger', 'extraBeat'];

function TileIcon({ name, tone }: { name: IconName; tone: 'accent' | 'flag' | 'neutral' }) {
  const { colors } = useTheme();
  const look = {
    accent: { bg: colors.buttonFill, fg: colors.onButtonFill },
    flag: { bg: colors.flagBg, fg: colors.flag },
    neutral: { bg: colors.textDim, fg: colors.bg },
  }[tone];
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: look.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={20} color={look.fg} />
    </View>
  );
}

function ChapterText({ heading, body }: { heading: string; body: string }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="title" accessibilityRole="header">
        {heading}
      </AppText>
      <AppText style={{ lineHeight: 24 }}>{body}</AppText>
    </View>
  );
}

function Takeaway({ text }: { text: string }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.sheet,
        backgroundColor: colors.accentTint,
      }}
    >
      <TileIcon name="check" tone="accent" />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
          {t('learn.takeawayLabel')}
        </AppText>
        <AppText variant="headline">{text}</AppText>
      </View>
    </View>
  );
}

function QuickCheck({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const { question } = lesson.template;
  const right = picked === question.correctIndex;
  return (
    <Card>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
        {t('learn.quickCheck')}
      </AppText>
      <AppText variant="headline">{question.prompt(t)}</AppText>
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm, marginTop: spacing.xs }}>
        {question.options(t).map((option, index) => {
          const isRight = picked === index && right;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked === index }}
              onPress={() => setPicked(index)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                minHeight: control.minTarget,
                paddingHorizontal: spacing.lg,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: isRight ? colors.accent : colors.line,
                backgroundColor: isRight ? colors.accentTint : colors.bg,
              }}
            >
              {isRight ? <Icon name="check" size={20} color={colors.accent} /> : null}
              <AppText style={isRight ? { color: colors.accent, fontWeight: '600' } : undefined}>
                {option}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {picked === null ? null : (
        <AppText
          accessibilityLiveRegion="polite"
          tone={right ? 'accent' : 'textDim'}
          style={{ fontWeight: '600' }}
        >
          {right ? t('learn.quizCorrect') : t('learn.quizTryAgain')}
        </AppText>
      )}
    </Card>
  );
}

function NextChapter({ next }: { next: Lesson }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, shadow, spacing } = useTheme();
  const number = lessons.indexOf(next) + 1;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('learn.nextLesson', { title: next.title(t) })}
      onPress={() => router.push(`/learn/${next.slug}`)}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.sheet,
          backgroundColor: colors.surface,
        },
        shadow.raised,
      ]}
    >
      <View
        style={{
          width: NEXT_NUMBER_SIZE,
          height: NEXT_NUMBER_SIZE,
          borderRadius: 12,
          backgroundColor: colors.buttonFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText style={{ color: colors.onButtonFill, fontWeight: '700', fontSize: 20, lineHeight: 24 }}>
          {number}
        </AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="caption" tone="textDim">
          {t('learn.nextChapter')}
        </AppText>
        <AppText variant="headline">{next.title(t)}</AppText>
      </View>
      <Icon name="chevron" size={14} color={colors.textFaint} />
    </PressableScale>
  );
}

function Panel({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Card>
      <View
        accessible={label !== undefined}
        accessibilityRole={label ? 'image' : undefined}
        accessibilityLabel={label}
      >
        {children}
      </View>
    </Card>
  );
}

export function RhythmChapter({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const progress = useReadProgress();
  const percent = progress[lesson.slug] ?? 0;
  const position = lessons.indexOf(lesson) + 1;
  const next = lessons[position];
  const [movement, loose, extra] = lesson.template.sections[1]!.chips!.items(t);
  const [intro, causes, limits] = lesson.template.sections;
  return (
    <View style={{ gap: 20 }}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('learn.bookProgress')}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={{
          height: PROGRESS_HEIGHT,
          borderRadius: PROGRESS_HEIGHT / 2,
          backgroundColor: colors.surface3,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${percent}%`, height: PROGRESS_HEIGHT, backgroundColor: colors.buttonFill }} />
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View
            style={{
              height: 24,
              paddingHorizontal: 10,
              borderRadius: 12,
              backgroundColor: colors.accentTint,
              justifyContent: 'center',
            }}
          >
            <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
              {t('learn.lessonProgress', { n: position, total: lessons.length })}
            </AppText>
          </View>
          <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
            {lessonLength(t, lesson)}
          </AppText>
        </View>
        <AppText variant="display" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
          {lesson.title(t)}
        </AppText>
      </View>

      <Card>
        <RhythmHero steps={[t('learn.rhythm.step1'), t('learn.rhythm.step2'), t('learn.rhythm.step3')]} />
        <AppText variant="subheadline" tone="textDim" style={{ marginTop: 6 }}>
          {t('learn.rhythm.heroCaption')}
        </AppText>
      </Card>

      <ChapterText heading={intro!.heading(t)} body={intro!.body(t)} />
      <Panel label={t('learn.rhythm.gapsLabel')}>
        <RhythmGapPanels />
      </Panel>

      <Panel label={t('learn.rhythm.mapsLabel')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md }}>
          <TileIcon name="rhythm" tone="accent" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="headline">{t('learn.rhythm.mapTitle')}</AppText>
            <AppText variant="caption" tone="textDim">
              {t('learn.rhythm.mapHint')}
            </AppText>
          </View>
        </View>
        <RhythmMapPair />
      </Panel>

      <ChapterText heading={causes!.heading(t)} body={causes!.body(t)} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[movement, loose, extra].map((cause, index) => (
          <View
            key={cause}
            style={{
              flex: 1,
              minWidth: 0,
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: 20,
              backgroundColor: colors.surface,
            }}
          >
            <TileIcon name={CAUSE_ICONS[index]!} tone="flag" />
            <AppText variant="subheadline" style={{ fontWeight: '600', lineHeight: 19 }}>
              {cause}
            </AppText>
          </View>
        ))}
      </View>

      <ChapterText heading={limits!.heading(t)} body={limits!.body(t)} />
      <Panel label={t('learn.rhythm.extraLabel')}>
        <ExtraBeatMapPair />
        <AppText variant="subheadline" tone="textDim" style={{ marginTop: spacing.md }}>
          {t('learn.rhythmExtraBeatsNote')}
        </AppText>
      </Panel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: 18,
          backgroundColor: colors.accentTint,
        }}
      >
        <TileIcon name="care" tone="accent" />
        <AppText variant="headline" tone="accent" style={{ flex: 1 }}>
          {t('learn.rhythm.answerDoctor')}
        </AppText>
      </View>

      <RhythmFigures />

      <Takeaway text={lesson.template.takeaway(t)} />
      <QuickCheck lesson={lesson} />
      {next ? <NextChapter next={next} /> : null}
      <AppText variant="caption" tone="textDim">
        {t('learn.chapterProgress', { n: position, total: lessons.length, percent })}
      </AppText>
    </View>
  );
}

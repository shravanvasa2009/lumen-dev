import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import { LessonDiagram } from './LessonDiagram';
import {
  lessons,
  type Lesson,
  type LessonQuestion,
  type LessonSection,
  type LessonTemplate,
} from './lessons';
import { RhythmFigures } from './RhythmFigures';

const NUMBER_SIZE = 28;
const PROGRESS_HEIGHT = 4;

function ProgressBar({ position }: { position: number }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="caption" tone="textDim">
        {t('learn.lessonProgress', { n: position, total: lessons.length })}
      </AppText>
      <View accessibilityElementsHidden style={{ flexDirection: 'row', gap: spacing.xs }}>
        {lessons.map((lesson, index) => (
          <View
            key={lesson.slug}
            style={{
              flex: 1,
              height: PROGRESS_HEIGHT,
              borderRadius: radius.pill,
              backgroundColor: index < position ? colors.accentFill : colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function SectionCard({ number, section }: { number: number; section: LessonSection }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const chipItems = section.chips?.items(t) ?? [];
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: NUMBER_SIZE,
            height: NUMBER_SIZE,
            borderRadius: radius.pill,
            backgroundColor: colors.accentFill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="caption" style={{ color: colors.onAccentFill }}>
            {number}
          </AppText>
        </View>
        <AppText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>
          {section.heading(t)}
        </AppText>
      </View>
      <AppText tone="textDim">{section.body(t)}</AppText>
      {section.diagram ? <LessonDiagram id={section.diagram} /> : null}
      {chipItems.length > 0 ? (
        <>
          {section.chips?.label ? (
            <AppText variant="caption" tone="textDim">
              {section.chips.label(t)}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {chipItems.map((chip) => (
              <View
                key={chip}
                style={{
                  backgroundColor: colors.surface2,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <AppText variant="caption">{chip}</AppText>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}

function MeasuredFigures() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <AppText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>
          {t('learn.rhythmTestingHeading')}
        </AppText>
        <EvidenceBadge metric="rhythm" />
      </View>
      <RhythmFigures />
    </View>
  );
}

function Takeaway({ text }: { text: string }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.badgeCheckedBg,
        borderRadius: radius.card,
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      <AppText variant="caption" style={{ color: colors.badgeCheckedFg }}>
        {t('learn.takeawayLabel')}
      </AppText>
      <AppText variant="headline" style={{ color: colors.badgeCheckedFg }}>
        {text}
      </AppText>
    </View>
  );
}

function QuickCheck({ question }: { question: LessonQuestion }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const answeredRight = picked === question.correctIndex;
  return (
    <Card>
      <AppText variant="caption" tone="textDim">
        {t('learn.quickCheck')}
      </AppText>
      <AppText variant="headline">{question.prompt(t)}</AppText>
      {question.options(t).map((option, index) => {
        const isRight = picked === index && answeredRight;
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
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: isRight ? colors.accent : picked === index ? colors.line2 : colors.line,
              backgroundColor: isRight ? colors.badgeCheckedBg : colors.surface,
            }}
          >
            {isRight ? <Icon name="check" size={control.chevronSize} color={colors.badgeCheckedFg} /> : null}
            <AppText style={isRight ? { color: colors.badgeCheckedFg } : undefined}>{option}</AppText>
          </Pressable>
        );
      })}
      {picked === null ? null : (
        <AppText accessibilityLiveRegion="polite" tone="textDim">
          {answeredRight ? t('learn.quizCorrect') : t('learn.quizTryAgain')}
        </AppText>
      )}
    </Card>
  );
}

export function LessonTemplateView({ lesson, template }: { lesson: Lesson; template: LessonTemplate }) {
  const { t } = useTranslation();
  const router = useRouter();
  const position = lessons.indexOf(lesson) + 1;
  const nextLesson = lessons[position];
  return (
    <>
      <ProgressBar position={position} />
      {template.heroDiagram ? (
        <Card>
          <LessonDiagram id={template.heroDiagram} />
        </Card>
      ) : null}
      {template.sections.map((section, index) => (
        <SectionCard key={section.heading(t)} number={index + 1} section={section} />
      ))}
      {lesson.showsRhythmFigures ? <MeasuredFigures /> : null}
      <Takeaway text={template.takeaway(t)} />
      <QuickCheck question={template.question} />
      {nextLesson ? (
        <Button
          label={t('learn.nextLesson', { title: nextLesson.title(t) })}
          onPress={() => router.push(`/learn/${nextLesson.slug}`)}
        />
      ) : null}
    </>
  );
}

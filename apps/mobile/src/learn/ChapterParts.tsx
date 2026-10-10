import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Svg from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

import { ChapterIcon, type ChapterIconName } from './chapterIcons';
import { type GlyphName, LessonGlyph } from './LessonGlyph';
import { type Lesson, type LessonQuestion, lessonLength, lessons } from './lessons';

export type ChapterTone = 'teal' | 'amber' | 'pulse' | 'alert' | 'neutral';

const TILE_SIZE = 36;
const TILE_ICON = 20;
const BLOCK_GAP = 20;
const GLYPH_TILE_SIZE = 40;
const GLYPH_SIZE = 20;

type ToneLook = { fill: string; onFill: string; tint: string; ink: string };

// Red here is the safety-check red from the alert tokens. Only the emergency screen may draw the critical red (SAFE-1).
export function useToneLook(): (tone: ChapterTone) => ToneLook {
  const { colors, isDark } = useTheme();
  const onFill = isDark ? colors.onAccentFill : colors.onButtonFill;
  return (tone) =>
    ({
      teal: {
        fill: colors.buttonFill,
        onFill: colors.onButtonFill,
        tint: colors.accentTint,
        ink: colors.accent,
      },
      amber: { fill: colors.flag, onFill, tint: colors.flagBg, ink: colors.flag },
      pulse: { fill: colors.pulse, onFill, tint: colors.surface2, ink: colors.pulse },
      alert: {
        fill: colors.alertFill,
        onFill: colors.onAlertFill,
        tint: colors.alertTint,
        ink: colors.alertText,
      },
      neutral: { fill: colors.textDim, onFill, tint: colors.surface2, ink: colors.textDim },
    })[tone];
}

export function IconTile({
  icon,
  tone,
  solid = true,
  size = TILE_SIZE,
}: {
  icon: ChapterIconName;
  tone: ChapterTone;
  solid?: boolean;
  size?: number;
}) {
  const look = useToneLook()(tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        backgroundColor: solid ? look.fill : look.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ChapterIcon name={icon} size={TILE_ICON} color={solid ? look.onFill : look.ink} />
    </View>
  );
}

export function SectionText({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children?: ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: 6 }}>
        <AppText variant="title" accessibilityRole="header">
          {heading}
        </AppText>
        <AppText style={{ lineHeight: 24 }}>{body}</AppText>
      </View>
      {children}
    </View>
  );
}

// A white card; when it carries a label the whole drawing reads as one image to a screen reader.
export function GraphicCard({
  label,
  inset = 'lg',
  children,
}: {
  label?: string;
  inset?: 'md' | 'lg';
  children: ReactNode;
}) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      {...(label === undefined
        ? null
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.sheet,
        padding: spacing[inset],
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

// Scales a drawing to the card width while keeping its proportions, so nothing clips on a 360 dp phone.
export function Figure({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <View style={{ aspectRatio: width / height }}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Svg>
    </View>
  );
}

export function PanelFigure({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.plotPanel, borderRadius: 20, overflow: 'hidden' }}>
      <Figure width={width} height={height}>
        {children}
      </Figure>
    </View>
  );
}

export function CardHeading({
  icon,
  tone,
  title,
  subtitle,
}: {
  icon: ChapterIconName;
  tone: ChapterTone;
  title: string;
  subtitle?: string;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2 }}>
      <IconTile icon={icon} tone={tone} />
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="textDim">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

// extra is a small picture drawn under the label.
export type Tile = { icon: ChapterIconName; label: string; extra?: ReactNode };

// Small equal tiles in one row: an icon above a short label.
export function TileRow({
  tiles,
  tone,
  background,
  solid = false,
  sideBySide = false,
}: {
  tiles: readonly Tile[];
  tone: ChapterTone;
  background: 'card' | 'tint';
  solid?: boolean;
  // Icon beside the label instead of above it.
  sideBySide?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const look = useToneLook()(tone);
  return (
    <View accessibilityRole="list" style={{ flexDirection: 'row', gap: spacing.sm }}>
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessibilityRole="none"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 10,
            borderRadius: 20,
            gap: spacing.sm,
            ...(sideBySide ? { flexDirection: 'row' as const, alignItems: 'center' as const } : null),
            backgroundColor: background === 'card' ? colors.surface : look.tint,
          }}
        >
          <IconTile icon={tile.icon} tone={tone} solid={solid} />
          <AppText
            numberOfLines={3}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{ fontSize: 15, lineHeight: 19, fontWeight: '600', flexShrink: 1 }}
          >
            {tile.label}
          </AppText>
          {tile.extra}
        </View>
      ))}
    </View>
  );
}

export type Step = { icon: ChapterIconName; tone: ChapterTone; solid: boolean; label: string };

// A vertical list joined by a thin line between the icon tiles.
export function StepList({ steps }: { steps: readonly Step[] }) {
  const { colors, spacing } = useTheme();
  return (
    <View accessibilityRole="list" style={{ gap: spacing.md }}>
      {steps.map((step, index) => (
        <View key={step.label} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {index < steps.length - 1 ? (
            <View
              style={{
                position: 'absolute',
                left: TILE_SIZE / 2 - 1,
                top: TILE_SIZE + 4,
                bottom: -spacing.md,
                width: 2,
                borderRadius: 1,
                backgroundColor: colors.surface3,
              }}
            />
          ) : null}
          <IconTile icon={step.icon} tone={step.tone} solid={step.solid} />
          <AppText variant="headline" style={{ flex: 1 }}>
            {step.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function NoteBanner({ icon, tone, text }: { icon: ChapterIconName; tone: ChapterTone; text: string }) {
  const look = useToneLook()(tone);
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: 18,
        backgroundColor: look.tint,
      }}
    >
      <IconTile icon={icon} tone={tone} />
      <AppText variant="headline" style={{ flex: 1, color: look.ink }}>
        {text}
      </AppText>
    </View>
  );
}

// One screen-reader stop per figure: the drawing is hidden, so its words travel in the label.
export function describedImage(label: string) {
  return { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label };
}

export function GlyphTile({
  name,
  tint,
  color,
  size = GLYPH_TILE_SIZE,
}: {
  name: GlyphName;
  tint: string;
  color: string;
  size?: number;
}) {
  const { radius } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.chip + 4,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LessonGlyph name={name} size={size > GLYPH_TILE_SIZE - 8 ? GLYPH_SIZE : 16} color={color} />
    </View>
  );
}

export function CardHeader({
  glyph,
  title,
  subtitle,
}: {
  glyph: GlyphName;
  title: string;
  subtitle: string;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <GlyphTile name={glyph} tint={colors.accentTint} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="caption" tone="textDim">
          {subtitle}
        </AppText>
      </View>
    </View>
  );
}

export function FigureCard({ children }: { children: ReactNode }) {
  const { colors, radius, spacing, shadow } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.lg,
        gap: spacing.md,
        ...shadow.raised,
      }}
    >
      {children}
    </View>
  );
}

type ActionTone = 'teal' | 'red';

export function ActionButton({
  label,
  glyph,
  tone,
  onPress,
}: {
  label: string;
  glyph: GlyphName;
  tone: ActionTone;
  onPress: () => void;
}) {
  const { colors, control, radius, spacing } = useTheme();
  const fill = tone === 'red' ? colors.alertFill : colors.buttonFill;
  const ink = tone === 'red' ? colors.onAlertFill : colors.onButtonFill;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: control.primaryButtonHeight,
        borderRadius: radius.card - 4,
        backgroundColor: fill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
      }}
    >
      <LessonGlyph name={glyph} size={GLYPH_SIZE} color={ink} />
      <AppText variant="headline" style={{ color: ink }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

// A card-sized row that leads somewhere: next chapter, a Settings screen, or back to Learn.
export function LinkTile({
  leading,
  kicker,
  title,
  accessibilityLabel,
  onPress,
}: {
  leading: ReactNode;
  kicker: string;
  title: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors, control, radius, spacing, shadow } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.lg,
        ...shadow.raised,
      }}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <AppText variant="caption" tone="textDim">
          {kicker}
        </AppText>
        <AppText variant="headline">{title}</AppText>
      </View>
      <LessonGlyph name="chevron" size={control.chevronSize} color={colors.textFaint} weight={2.5} />
    </PressableScale>
  );
}

function BookProgress({ position }: { position: number }) {
  const { t } = useTranslation();
  const { colors, radius } = useTheme();
  const percent = Math.floor((position / lessons.length) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('learn.bookProgress')}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: 'hidden' }}
    >
      <View
        style={{
          width: `${(position / lessons.length) * 100}%`,
          height: 4,
          backgroundColor: colors.accentFill,
        }}
      />
    </View>
  );
}

function ChapterHeader({ lesson, position }: { lesson: Lesson; position: number }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
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
        <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', flexShrink: 1 }}>
          {lessonLength(t, lesson)}
        </AppText>
      </View>
      <AppText variant="display" accessibilityRole="header">
        {lesson.title(t)}
      </AppText>
    </View>
  );
}

function TakeawayCard({ tone, text }: { tone: ChapterTone; text: string }) {
  const { t } = useTranslation();
  const { radius, spacing } = useTheme();
  const look = useToneLook()(tone);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.sheet,
        backgroundColor: look.tint,
      }}
    >
      <IconTile icon="bulb" tone={tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="caption" style={{ color: look.ink, fontWeight: '600' }}>
          {t('learn.takeawayLabel')}
        </AppText>
        <AppText variant="headline">{text}</AppText>
      </View>
    </View>
  );
}

function ChapterQuiz({ question }: { question: LessonQuestion }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const answeredRight = picked === question.correctIndex;
  const prompt = question.prompt(t);
  return (
    <View
      style={{ padding: spacing.lg, borderRadius: radius.sheet, backgroundColor: colors.surface, gap: 10 }}
    >
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
        {t('learn.quickCheck')}
      </AppText>
      <AppText variant="headline">{prompt}</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={prompt} style={{ gap: spacing.sm }}>
        {question.options(t).map((option, index) => {
          const isPicked = picked === index;
          const isRight = isPicked && answeredRight;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: isPicked }}
              onPress={() => setPicked(index)}
              style={{
                minHeight: 52,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderRadius: 18,
                justifyContent: 'center',
                borderWidth: isPicked ? 2 : 1,
                borderColor: isRight ? colors.accent : isPicked ? colors.textFaint : colors.line,
                backgroundColor: isRight ? colors.accentTint : isPicked ? colors.bg : colors.surface,
              }}
            >
              <AppText
                style={{
                  color: isRight ? colors.accent : isPicked ? colors.textDim : colors.text,
                  fontWeight: isRight ? '600' : '400',
                }}
              >
                {option}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {picked === null ? null : answeredRight ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
        >
          <ChapterIcon name="check" size={20} color={colors.accent} weight={2.5} />
          <AppText variant="headline" tone="accent">
            {t('learn.quizCorrect')}
          </AppText>
        </View>
      ) : (
        <AppText accessibilityLiveRegion="polite" tone="textDim">
          {t('learn.quizTryAgain')}
        </AppText>
      )}
    </View>
  );
}

function NextChapter({ position }: { position: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const next = lessons[position];
  // After the last chapter the mockup ends on a tile back to the Learn tab.
  if (!next) {
    return (
      <LinkTile
        leading={<GlyphTile name="check" tint={colors.buttonFill} color={colors.onButtonFill} />}
        kicker={t('learn.doctor.finished')}
        title={t('learn.doctor.backToLearn')}
        accessibilityLabel={t('learn.doctor.backToLearn')}
        onPress={() => router.navigate('/learn')}
      />
    );
  }
  const title = next.title(t);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('learn.nextLesson', { title })}
      onPress={() => router.push(`/learn/${next.slug}`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.sheet,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: colors.buttonFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText style={{ fontSize: 20, lineHeight: 24, fontWeight: '700', color: colors.onButtonFill }}>
          {position + 1}
        </AppText>
      </View>
      <View style={{ flex: 1 }} importantForAccessibility="no-hide-descendants">
        <AppText variant="caption" tone="textDim">
          {t('learn.nextChapter')}
        </AppText>
        <AppText variant="headline">{title}</AppText>
      </View>
      <ChapterIcon name="arrow" size={20} color={colors.glyph} />
    </PressableScale>
  );
}

// The shared shell of an illustrated chapter: progress bar, title block, the chapter's own blocks, then the
// takeaway, the quick check and the link to the next chapter.
export function ChapterFrame({
  lesson,
  tone = 'teal',
  children,
}: {
  lesson: Lesson;
  tone?: ChapterTone;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const position = lessons.indexOf(lesson) + 1;
  const percent = Math.floor((position / lessons.length) * 100);
  return (
    <View style={{ gap: BLOCK_GAP }}>
      <BookProgress position={position} />
      <ChapterHeader lesson={lesson} position={position} />
      {children}
      <TakeawayCard tone={tone} text={lesson.template.takeaway(t)} />
      <ChapterQuiz question={lesson.template.question} />
      <NextChapter position={position} />
      <AppText variant="caption" style={{ textAlign: 'center', color: colors.textDim }}>
        {t('learn.chapterProgress', { n: position, total: lessons.length, percent })}
      </AppText>
    </View>
  );
}

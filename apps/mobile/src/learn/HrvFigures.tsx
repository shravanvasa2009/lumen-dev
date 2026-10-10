import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { CardHeader, describedImage, Figure, FigureCard, GlyphTile, LinkTile } from './ChapterParts';
import { pulsePath } from './chapterWaves';
import { type GlyphName, LessonGlyph } from './LessonGlyph';

const HERO_WIDTH = 338;
const HERO_HEIGHT = 128;
const heroBeats = [22.5, 81, 143.2, 200.2, 261, 320.6] as const;
// Gaps are shown in ms; these are drawn numbers for the picture, not a measurement.
const heroGaps = [812, 868, 790, 845, 826] as const;

export function HrvHero({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { colors, radius, spacing, shadow } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.sm,
        gap: spacing.md,
        ...shadow.raised,
      }}
    >
      <View
        {...describedImage(t('learn.hrv.heroLabel'))}
        style={{ backgroundColor: colors.plotPanel, borderRadius: radius.card - 6, padding: spacing.md }}
      >
        <Figure width={HERO_WIDTH} height={HERO_HEIGHT}>
          <SvgText x={0} y={12} fill={colors.onPlot} fillOpacity={0.7} fontSize={12} fontWeight="600">
            {t('learn.hrv.timeBetween')}
          </SvgText>
          {heroGaps.map((gap, index) => {
            const from = heroBeats[index] ?? 0;
            const to = heroBeats[index + 1] ?? 0;
            return (
              <SvgText
                key={from}
                x={(from + to) / 2}
                y={32}
                fill={colors.onPlot}
                fontSize={12}
                fontWeight="700"
                textAnchor="middle"
              >
                {gap}
              </SvgText>
            );
          })}
          <Path
            d={heroBeats
              .slice(0, -1)
              .map((from, index) => `M${from + 1.5} 42v-5h${(heroBeats[index + 1] ?? 0) - from - 4}v5`)
              .join('')}
            stroke={colors.onPlot}
            strokeOpacity={0.6}
            strokeWidth={1.25}
            fill="none"
          />
          <Path
            d={pulsePath(heroBeats, { width: HERO_WIDTH, baseY: 120, amplitude: 62 })}
            stroke={colors.pulse}
            strokeWidth={2.5}
            strokeLinejoin="round"
            fill="none"
          />
          {heroBeats.map((x) => (
            <Circle
              key={x}
              cx={x}
              cy={58}
              r={4}
              fill={colors.accentFill}
              stroke={colors.plotPanel}
              strokeWidth={1.5}
            />
          ))}
        </Figure>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.line2,
            paddingTop: spacing.md,
          }}
        >
          <AppText variant="headline" style={{ color: colors.onPlot, flex: 1 }}>
            {t('learn.hrv.gapsChange')}
          </AppText>
          <View
            style={{
              backgroundColor: colors.accentFill,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            }}
          >
            <AppText variant="caption" style={{ color: colors.onAccentFill, fontWeight: '700' }}>
              {t('learn.hrv.equalsHrv')}
            </AppText>
          </View>
        </View>
      </View>
      <View style={{ gap: spacing.sm, padding: spacing.sm }}>{children}</View>
    </View>
  );
}

const BAR_AREA_HEIGHT = 48;
const BAR_PIXELS_PER_MS = 0.0621;
const BAR_BASELINE = 44;
const metronomeGaps = [830, 830, 830, 830, 830, 830] as const;
const healthyGaps = [812, 868, 790, 845, 826, 880] as const;

// Beat x positions along the strip: each gap is as wide as its length in ms.
function beatPositions(gaps: readonly number[]): readonly number[] {
  return gaps.reduce<number[]>(
    (positions, gap) => [...positions, (positions.at(-1) ?? 13) + gap * BAR_PIXELS_PER_MS],
    [13],
  );
}

// Bar height grows 0.14 per ms from a 26.6 floor, exaggerated so a few ms of change is visible.
function barHeight(gap: number): number {
  return 26.6 + 0.14 * (gap - 790);
}

function GapStrip({
  gaps,
  beatColor,
  stemColor,
}: {
  gaps: readonly number[];
  beatColor: string;
  stemColor: string;
}) {
  const { colors } = useTheme();
  const beats = beatPositions(gaps);
  return (
    <Figure width={338} height={40}>
      {gaps.map((gap, index) => {
        const from = beats[index] ?? 0;
        const to = beats[index + 1] ?? 0;
        return (
          <SvgText
            key={from}
            x={(from + to) / 2}
            y={10}
            fill={colors.textDim}
            fontSize={10.5}
            fontWeight="600"
            textAnchor="middle"
          >
            {gap}
          </SvgText>
        );
      })}
      <Path
        d={gaps
          .map(
            (_, index) =>
              `M${(beats[index] ?? 0) + 2} 13.5v3h${(beats[index + 1] ?? 0) - (beats[index] ?? 0) - 4}v-3`,
          )
          .join('')}
        stroke={colors.line}
        strokeWidth={1}
        fill="none"
      />
      {beats.map((x) => (
        <Line key={x} x1={x} y1={22} x2={x} y2={38} stroke={stemColor} strokeWidth={1.5} />
      ))}
      {beats.map((x) => (
        <Circle key={x} cx={x} cy={22} r={3.5} fill={beatColor} stroke={colors.surface} strokeWidth={1.5} />
      ))}
    </Figure>
  );
}

function GapBars({ gaps, fill }: { gaps: readonly number[]; fill: string }) {
  const { colors } = useTheme();
  const beats = beatPositions(gaps);
  const tallest = Math.max(...gaps.map(barHeight));
  return (
    <Figure width={338} height={BAR_AREA_HEIGHT}>
      <Line x1={0} y1={BAR_BASELINE} x2={338} y2={BAR_BASELINE} stroke={colors.line} strokeWidth={1} />
      <Line
        x1={0}
        y1={BAR_BASELINE - tallest}
        x2={338}
        y2={BAR_BASELINE - tallest}
        stroke={fill}
        strokeOpacity={0.5}
        strokeDasharray="3 3"
      />
      {gaps.map((gap, index) => (
        <Rect
          key={beats[index]}
          x={(beats[index] ?? 0) + 4}
          y={BAR_BASELINE - barHeight(gap)}
          width={(beats[index + 1] ?? 0) - (beats[index] ?? 0) - 8}
          height={barHeight(gap)}
          rx={5}
          fill={fill}
          fillOpacity={0.85}
        />
      ))}
    </Figure>
  );
}

function StripBlock({
  glyph,
  title,
  gaps,
  steady,
}: {
  glyph: GlyphName;
  title: string;
  gaps: readonly number[];
  steady: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const accent = steady ? colors.glyph : colors.buttonFill;
  return (
    <View
      style={{
        backgroundColor: steady ? colors.surface2 : colors.accentTint,
        borderRadius: radius.card - 6,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <GlyphTile
          name={glyph}
          tint={colors.surface}
          color={steady ? colors.textDim : colors.accent}
          size={32}
        />
        <AppText variant="caption" style={{ flex: 1, fontWeight: '600' }}>
          {title}
        </AppText>
        <AppText variant="caption1" tone="textDim">
          {t('learn.hrv.gapUnit')}
        </AppText>
      </View>
      <GapStrip gaps={gaps} beatColor={accent} stemColor={steady ? colors.line2 : colors.accentFill} />
      <GapBars gaps={gaps} fill={accent} />
    </View>
  );
}

export function MetronomeVersusHeart() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <FigureCard>
      <View {...describedImage(t('learn.hrv.barsLabel'))} style={{ gap: spacing.md }}>
        <StripBlock glyph="metronome" title={t('learn.hrv.metronomeTitle')} gaps={metronomeGaps} steady />
        <StripBlock glyph="heart" title={t('learn.hrv.healthyTitle')} gaps={healthyGaps} steady={false} />
      </View>
      <AppText variant="caption" tone="textDim">
        {t('learn.hrv.barsCaption')}
      </AppText>
    </FigureCard>
  );
}

function Chip({ glyph, label }: { glyph: GlyphName; label: string }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.xs + 2,
        backgroundColor: colors.surface2,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 2,
      }}
    >
      <LessonGlyph name={glyph} size={14} color={colors.accent} weight={2.2} />
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

function CauseCard({
  glyph,
  tint,
  ink,
  title,
  lead,
  chips,
}: {
  glyph: GlyphName;
  tint: string;
  ink: string;
  title: string;
  lead: string;
  chips: readonly { glyph: GlyphName; label: string }[];
}) {
  const { colors, radius, spacing, shadow } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.md,
        gap: spacing.sm,
        ...shadow.raised,
      }}
    >
      <GlyphTile name={glyph} tint={tint} color={ink} size={36} />
      <AppText variant="headline">{title}</AppText>
      <AppText variant="caption" tone="textDim">
        {lead}
      </AppText>
      {chips.map((chip) => (
        <Chip key={chip.label} glyph={chip.glyph} label={chip.label} />
      ))}
    </View>
  );
}

export function HigherAndLowerCards() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <CauseCard
        glyph="arrowUp"
        tint={colors.accentTint}
        ink={colors.accent}
        title={t('learn.hrv.higherTitle')}
        lead={t('learn.hrv.goesWith')}
        chips={[
          { glyph: 'bolt', label: t('learn.hrv.chipStress') },
          { glyph: 'dumbbell', label: t('learn.hrv.chipExercise') },
          { glyph: 'moon', label: t('learn.hrv.chipSleep') },
        ]}
      />
      <CauseCard
        glyph="arrowDown"
        tint={colors.flagBg}
        ink={colors.flag}
        title={t('learn.hrv.dropTitle')}
        lead={t('learn.hrv.whenYouAre')}
        chips={[
          { glyph: 'battery', label: t('learn.hrv.chipTired') },
          { glyph: 'trendDown', label: t('learn.hrv.chipRunDown') },
        ]}
      />
    </View>
  );
}

const weekLabelXs = [70, 150, 230, 306] as const;

export function HrvOverWeeks() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <FigureCard>
      <CardHeader
        glyph="trendUp"
        title={t('learn.hrv.weeksTitle')}
        subtitle={t('learn.hrv.illustrationNote')}
      />
      <View {...describedImage(t('learn.hrv.weeksLabel'))}>
        <Figure width={338} height={132}>
          <Rect x={136} y={6} width={108} height={106} rx={12} fill={colors.flagBg} />
          <SvgText x={190} y={24} textAnchor="middle" fill={colors.flag} fontSize={11} fontWeight="600">
            {t('learn.hrv.tiredRunDown')}
          </SvgText>
          <SvgText x={0} y={12} fill={colors.textDim} fontSize={10.5} fontWeight="600">
            {t('learn.hrv.higher')}
          </SvgText>
          <SvgText x={0} y={108} fill={colors.textDim} fontSize={10.5} fontWeight="600">
            {t('learn.hrv.lower')}
          </SvgText>
          <Line x1={0} y1={112} x2={338} y2={112} stroke={colors.line} strokeWidth={1} />
          <Path
            d="M44 48 C60 42, 76 54, 96 46 S126 44, 142 54 C158 66, 170 96, 190 98 S222 88, 240 70 C256 54, 290 40, 330 42"
            stroke={colors.accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx={190} cy={98} r={4} fill={colors.flag} stroke={colors.surface} strokeWidth={1.5} />
          <Circle cx={330} cy={42} r={4} fill={colors.accent} stroke={colors.surface} strokeWidth={1.5} />
          <SvgText x={330} y={30} textAnchor="end" fill={colors.accent} fontSize={11} fontWeight="600">
            {t('learn.hrv.recovered')}
          </SvgText>
          {weekLabelXs.map((x, index) => (
            <SvgText key={x} x={x} y={128} textAnchor="middle" fill={colors.textFaint} fontSize={10.5}>
              {t('learn.hrv.week', { n: index + 1 })}
            </SvgText>
          ))}
        </Figure>
      </View>
    </FigureCard>
  );
}

// Weekly dot clusters: x positions across 338 units and the height of each own-reading dot.
const usualDots = [
  [16, 70],
  [38, 62],
  [60, 76],
  [104, 66],
  [126, 58],
  [148, 74],
  [192, 82],
  [214, 64],
  [236, 72],
  [280, 60],
  [302, 68],
  [324, 64],
] as const;
const bandWeekXs = [42, 127, 211, 296] as const;

function UsualBand() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View {...describedImage(t('learn.hrv.bandLabel'))}>
      <Figure width={338} height={152}>
        <Path
          d="M84.5 8V124M169 8V124M253.5 8V124"
          stroke={colors.line}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <Rect x={0} y={48} width={338} height={44} rx={8} fill={colors.accentTint} />
        <Path
          d="M0 48H338M0 92H338"
          stroke={colors.accent}
          strokeWidth={1}
          strokeDasharray="3 3"
          strokeOpacity={0.5}
        />
        <SvgText x={8} y={40} fill={colors.accent} fontSize={11} fontWeight="600">
          {t('learn.hrv.bandInline')}
        </SvgText>
        {usualDots.map(([x, y]) => (
          <Circle
            key={x}
            cx={x}
            cy={y}
            r={4.5}
            fill={colors.accent}
            stroke={colors.surface}
            strokeWidth={1.5}
          />
        ))}
        <Circle cx={264} cy={112} r={4.5} fill={colors.flag} stroke={colors.surface} strokeWidth={1.5} />
        <SvgText x={254} y={116} textAnchor="end" fill={colors.flag} fontSize={11} fontWeight="600">
          {t('learn.hrv.belowUsual')}
        </SvgText>
        {bandWeekXs.map((x, index) => (
          <SvgText key={x} x={x} y={146} textAnchor="middle" fill={colors.textFaint} fontSize={10.5}>
            {t('learn.hrv.week', { n: index + 1 })}
          </SvgText>
        ))}
      </Figure>
    </View>
  );
}

function CompareTile({ yes, title, subtitle }: { yes: boolean; title: string; subtitle: string }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: yes ? colors.accentTint : colors.surface2,
        borderRadius: radius.card - 6,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.pill,
          backgroundColor: yes ? colors.buttonFill : colors.glyph,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LessonGlyph
          name={yes ? 'check' : 'cross'}
          size={16}
          color={yes ? colors.onButtonFill : colors.surface}
          weight={2.6}
        />
      </View>
      <AppText variant="headline" style={yes ? { color: colors.accent } : { color: colors.textDim }}>
        {title}
      </AppText>
      <AppText variant="caption" tone="textDim">
        {subtitle}
      </AppText>
    </View>
  );
}

export function YourUsualBand() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <FigureCard>
      <CardHeader glyph="band" title={t('learn.hrv.bandTitle')} subtitle={t('learn.hrv.bandSub')} />
      <UsualBand />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <LessonGlyph name="clock" size={16} color={colors.textDim} />
        <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
          {t('learn.hrv.dotNote')}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <CompareTile yes title={t('learn.hrv.youVsYou')} subtitle={t('learn.hrv.ownWeeks')} />
        <CompareTile yes={false} title={t('learn.hrv.youVsOthers')} subtitle={t('learn.hrv.h3')} />
      </View>
    </FigureCard>
  );
}

export function AccuracyLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <LinkTile
      leading={<GlyphTile name="gauge" tint={colors.accentTint} color={colors.accent} />}
      kicker={t('settings.title')}
      title={t('settings.accuracy')}
      accessibilityLabel={`${t('settings.title')}: ${t('settings.accuracy')}`}
      onPress={() => router.push('/settings/accuracy')}
    />
  );
}

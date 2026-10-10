import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { jitterPath, panelArt, pulseTracePath } from './chapterArt';
import { ChapterIcon } from './chapterIcons';
import { Figure, GraphicCard, PanelFigure } from './ChapterParts';

// Skin and blood tones are fixed art: they sit on the dark panel in both themes.
const flesh = {
  skin: '#C9A27A',
  highlight: '#F4DCC4',
  blood: '#E0352E',
  deepBlood: '#7A0C17',
  glowInner: '#FF7A4D',
  glowOuter: '#C8222B',
  tipDark: '#9E2F27',
  tipLight: '#F27A4E',
  vesselCore: '#C8222B',
  cue: '#FFE08A',
  body: '#2A2F3A',
  bodyLine: '#4A5263',
  flashLamp: '#F3E9C8',
  lens: '#1D2536',
  lensLine: '#7A8499',
  lensGlass: '#0E1420',
} as const;

const HERO_W = 338;
const HERO_H = 214;

export function FingertipHero() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <GraphicCard label={t('learn.ch1.heroLabel')} inset="md">
      <PanelFigure width={HERO_W} height={HERO_H}>
        <Defs>
          <RadialGradient id="ch1Glow" gradientUnits="userSpaceOnUse" cx={160} cy={150} r={130}>
            <Stop offset={0} stopColor={flesh.glowInner} stopOpacity={0.95} />
            <Stop offset={0.45} stopColor={flesh.blood} stopOpacity={0.6} />
            <Stop offset={1} stopColor={flesh.glowOuter} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect
          x={16}
          y={152}
          width={306}
          height={46}
          rx={14}
          fill={flesh.body}
          stroke={flesh.bodyLine}
          strokeWidth={1.5}
        />
        <Path d="M70 152C70 104 98 72 150 72H338V152Z" fill={flesh.skin} />
        <Path d="M70 152C70 104 98 72 150 72H338V152Z" fill="url(#ch1Glow)" opacity={0.92} />
        <Path
          d="M104 78C116 72 130 70 148 70H204"
          fill="none"
          stroke={flesh.highlight}
          strokeWidth={5}
          strokeLinecap="round"
          opacity={0.55}
        />
        <Rect x={104} y={104} width={250} height={14} rx={7} fill={flesh.deepBlood} opacity={0.8} />
        {[128, 162, 196, 244, 282, 318].map((x) => (
          <Circle key={x} cx={x} cy={111} r={3} fill={flesh.blood} />
        ))}
        <Rect x={118} y={146} width={32} height={8} rx={4} fill={flesh.flashLamp} />
        <Rect
          x={196}
          y={144}
          width={52}
          height={10}
          rx={5}
          fill={flesh.lens}
          stroke={flesh.lensLine}
          strokeWidth={2}
        />
        <Rect x={212} y={146} width={20} height={6} rx={3} fill={flesh.lensGlass} />
        <Path
          d="M134 146C138 96 214 96 222 140"
          fill="none"
          stroke={flesh.cue}
          strokeWidth={2.25}
          strokeDasharray="5 5"
          strokeLinecap="round"
        />
        <Path
          d="M216 134.5 222 142 227 133.5"
          fill="none"
          stroke={flesh.cue}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M128 144 116 120M140 144 150 118"
          stroke={flesh.cue}
          strokeWidth={1.75}
          strokeDasharray="3 4"
          strokeLinecap="round"
          opacity={0.7}
        />
        <G stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1.25}>
          <Path d="M50 44 78 118" />
          <Path d="M178 44V96" />
          <Path d="M300 44V102" />
        </G>
        <G fill="#FFFFFF">
          <Circle cx={78} cy={118} r={3} />
          <Circle cx={178} cy={98} r={3} />
          <Circle cx={300} cy={104} r={3} />
        </G>
        <SvgText x={20} y={36} fill={colors.onPlot} fontSize={13} fontWeight="600">
          {t('learn.ch1.fingertip')}
        </SvgText>
        <SvgText x={178} y={36} fill={colors.onPlot} fontSize={13} fontWeight="600" textAnchor="middle">
          {t('learn.ch1.scatters')}
        </SvgText>
        <SvgText x={324} y={36} fill={colors.onPlot} fontSize={13} fontWeight="600" textAnchor="end">
          {t('learn.ch1.vessel')}
        </SvgText>
        <SvgText x={134} y={182} fill={colors.onPlot} fontSize={13} fontWeight="600" textAnchor="middle">
          {t('learn.ch1.flash')}
        </SvgText>
        <SvgText x={222} y={182} fill={colors.onPlot} fontSize={13} fontWeight="600" textAnchor="middle">
          {t('learn.ch1.camera')}
        </SvgText>
      </PanelFigure>
      <View style={{ paddingHorizontal: spacing.xs, paddingTop: spacing.md }}>
        <AppText variant="subheadline" tone="textDim">
          {t('learn.ch1.heroCaption')}
        </AppText>
      </View>
    </GraphicCard>
  );
}

const TIP_W = 163;
const TIP_H = 120;

function FingertipFrame({
  gradientId,
  fill,
  vesselRadius,
}: {
  gradientId: string;
  fill: string;
  vesselRadius: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <PanelFigure width={TIP_W} height={TIP_H}>
      <Defs>
        <RadialGradient id={gradientId} cx={0.5} cy={0.3} r={0.7}>
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.28} />
          <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={34} y={14} width={64} height={130} rx={32} fill={fill} />
      <Rect x={34} y={14} width={64} height={130} rx={32} fill={`url(#${gradientId})`} />
      <Circle cx={132} cy={58} r={22} fill={panelArt.inset} />
      <Circle cx={132} cy={58} r={vesselRadius} fill={flesh.vesselCore} />
      <SvgText x={132} y={98} fill={colors.onPlot} fontSize={10} textAnchor="middle">
        {t('learn.ch1.vesselWord')}
      </SvgText>
    </PanelFigure>
  );
}

// Weights of the dark and light spells along the strip; the five dark spots are the beats.
const beatPositions = [0.06, 0.2, 0.37, 0.54, 0.71, 0.88];
const STRIP_STOPS = 48;

function stripColor(at: number) {
  const dip = Math.max(...beatPositions.map((beat) => Math.exp(-(((at - beat) / 0.03) ** 2) / 2)));
  const channel = (light: number, dark: number) => Math.round(light + (dark - light) * dip);
  return `rgb(${channel(242, 142)},${channel(122, 34)},${channel(78, 34)})`;
}

export function BeatComparison() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const label = t('learn.ch1.pairLabel');
  return (
    <GraphicCard label={label}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <FingertipFrame gradientId="ch1SheenA" fill={flesh.tipDark} vesselRadius={15} />
            <AppText style={{ marginTop: spacing.sm, fontSize: 15, lineHeight: 20, fontWeight: '700' }}>
              {t('learn.pulse.darker')}
            </AppText>
            <AppText variant="caption" tone="textDim">
              {t('learn.ch1.moreBlood')}
            </AppText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <FingertipFrame gradientId="ch1SheenB" fill={flesh.tipLight} vesselRadius={9} />
            <AppText
              tone="textDim"
              style={{ marginTop: spacing.sm, fontSize: 15, lineHeight: 20, fontWeight: '700' }}
            >
              {t('learn.pulse.lighter')}
            </AppText>
            <AppText variant="caption" tone="textDim">
              {t('learn.ch1.lighterAgain')}
            </AppText>
          </View>
        </View>
        <Figure width={338} height={52}>
          <Defs>
            <LinearGradient id="ch1Strip" x1={0} y1={0} x2={1} y2={0}>
              {Array.from({ length: STRIP_STOPS + 1 }, (_, index) => (
                <Stop key={index} offset={index / STRIP_STOPS} stopColor={stripColor(index / STRIP_STOPS)} />
              ))}
            </LinearGradient>
          </Defs>
          <SvgText x={190} y={12} fill={colors.text} fontSize={12} fontWeight="600" textAnchor="end">
            {t('learn.pulse.darker')}
          </SvgText>
          <SvgText x={212} y={12} fill={colors.textDim} fontSize={12} fontWeight="600">
            {t('learn.pulse.lighter')}
          </SvgText>
          <Path d="M184 16V22" stroke={colors.text} strokeWidth={1.25} />
          <Path d="M216 16V22" stroke={colors.textDim} strokeWidth={1.25} />
          <Rect x={0} y={22} width={338} height={28} rx={10} fill="url(#ch1Strip)" />
        </Figure>
      </View>
    </GraphicCard>
  );
}

const FRAME_COLORS = [
  '#e9724a',
  '#8e2222',
  '#e9724a',
  '#d15d3f',
  '#f0784d',
  '#f27a4e',
  '#f27a4e',
  '#f1794e',
  '#8e2222',
  '#e77049',
];
const TRACE_BEATS = [58, 118.6, 179.2, 239.8, 300.4];

export function LightToBeats({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <GraphicCard>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: colors.buttonFill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChapterIcon name="camera" size={20} color={colors.onButtonFill} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{t('learn.ch1.fromLight')}</AppText>
            <AppText variant="caption" tone="textDim">
              {t('learn.ch1.fromLightSub')}
            </AppText>
          </View>
        </View>
        <View accessible accessibilityRole="image" accessibilityLabel={t('learn.ch1.traceLabel')}>
          <Figure width={338} height={64}>
            <SvgText x={0} y={12} fill={colors.textDim} fontSize={12} fontWeight="600">
              {t('learn.ch1.framesWord')}
            </SvgText>
            {FRAME_COLORS.map((fill, index) => (
              <Rect key={index} x={2 + index * 33.5} y={20} width={28} height={28} rx={7} fill={fill} />
            ))}
            <Path
              d="M163 54 169 60 175 54"
              fill="none"
              stroke={colors.line}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Figure>
          <Figure width={338} height={98}>
            <Path
              d={pulseTracePath({ width: 338, top: 22, bottom: 64, beats: TRACE_BEATS })}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {TRACE_BEATS.map((x) => (
              <Circle
                key={x}
                cx={x}
                cy={22}
                r={4}
                fill={colors.accent}
                stroke={colors.surface}
                strokeWidth={1.5}
              />
            ))}
            <SvgText x={58} y={12} fill={colors.accent} fontSize={12} fontWeight="600" textAnchor="middle">
              {t('learn.pulse.beatMark')}
            </SvgText>
            <Path d="M118.6 80v6h60.6v-6" fill="none" stroke={colors.accent} strokeWidth={1.5} />
            <SvgText x={148.9} y={97} fill={colors.accent} fontSize={12} fontWeight="600" textAnchor="middle">
              {t('learn.pulse.gapMark')}
            </SvgText>
          </Figure>
        </View>
        {children}
      </View>
    </GraphicCard>
  );
}

export function JitterChip({ seed }: { seed: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 8, backgroundColor: colors.flagBg, overflow: 'hidden' }}>
      <Svg
        width="100%"
        height={32}
        viewBox="0 0 94 32"
        preserveAspectRatio="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path
          d={jitterPath(94, 32, seed, 3)}
          fill="none"
          stroke={colors.flag}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const CLEAN_BEATS = [58, 118, 180, 240, 300];

export function SignalCompare() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const rows = [
    {
      title: t('learn.ch1.cleanSignal'),
      badge: t('learn.ch1.measures'),
      icon: 'check' as const,
      ink: colors.accent,
      tint: colors.accentTint,
      trace: (
        <Path
          d={pulseTracePath({ width: 338, top: 8, bottom: 48, beats: CLEAN_BEATS })}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2.25}
          strokeLinejoin="round"
        />
      ),
    },
    {
      title: t('learn.ch1.blurrySignal'),
      badge: t('learn.ch1.asksRetake'),
      icon: 'retake' as const,
      ink: colors.flag,
      tint: colors.flagBg,
      trace: (
        <Path
          d={jitterPath(338, 56, 7, 2)}
          fill="none"
          stroke={colors.flag}
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
      ),
    },
  ];
  return (
    <GraphicCard label={t('learn.ch1.compareLabel')}>
      {rows.map((row, index) => (
        <View key={row.title}>
          {index > 0 ? (
            <View style={{ height: 0.5, backgroundColor: colors.line, marginVertical: spacing.lg }} />
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: row.ink }} />
            <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
              {row.title}
            </AppText>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                height: 24,
                paddingHorizontal: 10,
                borderRadius: 12,
                backgroundColor: row.tint,
              }}
            >
              <ChapterIcon name={row.icon} size={14} color={row.ink} weight={2.5} />
              <AppText variant="caption" style={{ color: row.ink, fontWeight: '600' }}>
                {row.badge}
              </AppText>
            </View>
          </View>
          <View
            style={{ borderRadius: 14, backgroundColor: row.tint, paddingVertical: 4, overflow: 'hidden' }}
          >
            <Figure width={338} height={56}>
              {row.trace}
            </Figure>
          </View>
        </View>
      ))}
    </GraphicCard>
  );
}

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

import { useTheme } from '@/theme';

import { type BeatShape, pulsePath } from './rhythmFigureMath';

const HERO_WIDTH = 338;
const HERO_HEIGHT = 196;
const STRIP_HEIGHT = 52;
const TRACE_HEIGHT = 98;
const BEAT_XS = [55.24, 119.21, 183.9, 247.87, 311.11] as const;
const TRACE_SHAPE: BeatShape = {
  baseline: 64,
  peak: 42,
  bump: 17.5,
  bumpOffset: 19.5,
  peakWidth: 4.36,
  bumpWidth: 5.4,
};
// The fingertip is lit orange between beats and darkens red as each pulse passes.
const LIGHT_SKIN = [242, 122, 78] as const;
const DARK_SKIN = [110, 10, 22] as const;
const STRIP_STOPS = 72;
const STEP_ROWS = [40, 98, 156] as const;

const mix = (amount: number) =>
  LIGHT_SKIN.map((light, channel) => Math.round(light + (DARK_SKIN[channel]! - light) * amount)).join(',');

const darkness = (fraction: number) =>
  Math.min(
    1,
    BEAT_XS.reduce((sum, beatX) => sum + Math.exp(-(((fraction * HERO_WIDTH - beatX) / 5) ** 2) / 2), 0),
  );

// Breaks a step into two lines at the space nearest its middle, so both fit beside the numbered dot.
function twoLines(text: string): [string, string] {
  const middle = text.length / 2;
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index);
  const at = spaces.reduce(
    (best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best),
    spaces[0] ?? -1,
  );
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

type RhythmHeroProps = { steps: readonly [string, string, string] };

export function RhythmHero({ steps }: RhythmHeroProps) {
  const { t } = useTranslation();
  const { colors, gradients, radius, spacing } = useTheme();
  const tracePath = pulsePath(BEAT_XS, TRACE_SHAPE, HERO_WIDTH, 1.45);
  const beatDarker = t('learn.rhythm.stripBeat');
  const betweenLighter = t('learn.rhythm.stripBetween');
  return (
    <View style={{ borderRadius: radius.card, backgroundColor: colors.plotPanel, overflow: 'hidden' }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('learn.rhythm.heroLabel')}
        style={{ paddingTop: spacing.xs }}
      >
        <Svg
          width="100%"
          viewBox={`0 0 ${HERO_WIDTH} ${HERO_HEIGHT}`}
          style={{ aspectRatio: HERO_WIDTH / HERO_HEIGHT }}
        >
          <Defs>
            <RadialGradient id="rhythm-glow" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FF7A4D" stopOpacity={0.9} />
              <Stop offset="0.45" stopColor="#E0352E" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#C8222B" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="rhythm-tip" gradientUnits="userSpaceOnUse" cx="64" cy="70" r="46">
              {gradients.fingertip.stops.map(({ at, color }) => (
                <Stop key={at} offset={at} stopColor={color} />
              ))}
            </RadialGradient>
          </Defs>
          <Rect
            x={16}
            y={20}
            width={132}
            height={200}
            rx={28}
            fill={colors.illustrationDevice}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={1.5}
          />
          <Rect x={28} y={32} width={72} height={112} rx={22} fill={colors.illustrationDeviceIsland} />
          <Circle
            cx={64}
            cy={66}
            r={15}
            fill={colors.illustrationLens}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={2}
          />
          <Circle
            cx={64}
            cy={116}
            r={13}
            fill={colors.illustrationLens}
            stroke={colors.illustrationDeviceLine}
            strokeWidth={2}
          />
          <Circle cx={64} cy={116} r={5} fill={colors.plotPanel} />
          <Circle cx={90} cy={44} r={6.5} fill={colors.illustrationFlash} />
          <Circle cx={64} cy={66} r={58} fill="url(#rhythm-glow)" />
          <G transform="rotate(-38 64 66)">
            <Rect x={40} y={-90} width={48} height={182} rx={24} fill={colors.illustrationSkin} />
            <Rect x={40} y={-90} width={48} height={182} rx={24} fill="url(#rhythm-tip)" opacity={0.92} />
            <Rect x={49} y={58} width={30} height={26} rx={12} fill="#FFFFFF" opacity={0.22} />
          </G>
          <Path
            d="M86 50 79 57M92 52 88 60M83 44 76 48"
            stroke={colors.illustrationFlash}
            strokeWidth={1.75}
            strokeLinecap="round"
            opacity={0.85}
          />
          <Path
            d="M176 40V156"
            stroke={colors.illustrationDeviceLine}
            strokeWidth={2}
            strokeDasharray="2 4"
            opacity={0.6}
          />
          {STEP_ROWS.map((y, index) => {
            const [first, second] = twoLines(steps[index]!);
            return (
              <G key={y}>
                <Circle cx={176} cy={y} r={13} fill={colors.accentFill} />
                <SvgText
                  x={176}
                  y={y + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight="700"
                  fill={colors.onAccentFill}
                >
                  {index + 1}
                </SvgText>
                <SvgText x={198} y={y - 4} fontSize={14} fontWeight="600" fill={colors.onPlot}>
                  {first}
                </SvgText>
                <SvgText x={198} y={y + 13} fontSize={14} fontWeight="600" fill={colors.onPlot}>
                  {second}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
      <View style={{ paddingHorizontal: spacing.xs, paddingTop: spacing.md }}>
        <View accessible accessibilityRole="image" accessibilityLabel={t('learn.rhythm.stripLabel')}>
          <Svg
            width="100%"
            viewBox={`0 0 ${HERO_WIDTH} ${STRIP_HEIGHT}`}
            style={{ aspectRatio: HERO_WIDTH / STRIP_HEIGHT }}
          >
            <Defs>
              <LinearGradient id="rhythm-strip" x1="0" y1="0" x2="1" y2="0">
                {Array.from({ length: STRIP_STOPS + 1 }, (_, index) => (
                  <Stop
                    key={index}
                    offset={index / STRIP_STOPS}
                    stopColor={`rgb(${mix(darkness(index / STRIP_STOPS))})`}
                  />
                ))}
              </LinearGradient>
            </Defs>
            <SvgText x={189.9} y={12} textAnchor="end" fontSize={12} fontWeight="600" fill={colors.onPlot}>
              {beatDarker}
            </SvgText>
            <SvgText
              x={211.88}
              y={12}
              textAnchor="start"
              fontSize={12}
              fontWeight="600"
              fill={colors.onPlot}
              opacity={0.7}
            >
              {betweenLighter}
            </SvgText>
            <Path d="M183.9 16V22" stroke={colors.onPlot} strokeWidth={1.25} />
            <Path d="M215.88 16V22" stroke={colors.onPlot} strokeWidth={1.25} opacity={0.7} />
            <Rect x={0} y={22} width={HERO_WIDTH} height={28} rx={10} fill="url(#rhythm-strip)" />
          </Svg>
        </View>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('learn.rhythm.traceLabel')}
          style={{ marginTop: spacing.xs }}
        >
          <Svg
            width="100%"
            viewBox={`0 0 ${HERO_WIDTH} ${TRACE_HEIGHT}`}
            style={{ aspectRatio: HERO_WIDTH / TRACE_HEIGHT }}
          >
            <Path
              d={tracePath}
              fill="none"
              stroke={colors.pulse}
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {BEAT_XS.map((beatX) => (
              <Circle
                key={beatX}
                cx={beatX}
                cy={22}
                r={4}
                fill={colors.accentFill}
                stroke={colors.plotPanel}
                strokeWidth={1.5}
              />
            ))}
            <SvgText
              x={BEAT_XS[0]}
              y={12}
              textAnchor="middle"
              fontSize={12}
              fontWeight="600"
              fill={colors.accentFill}
            >
              {t('learn.rhythm.beatLabel')}
            </SvgText>
            <Path d="M119.21 80v6h64.69v-6" fill="none" stroke={colors.accentFill} strokeWidth={1.5} />
            <SvgText
              x={151.55}
              y={97}
              textAnchor="middle"
              fontSize={12}
              fontWeight="600"
              fill={colors.accentFill}
            >
              {t('learn.rhythm.betweenBeats')}
            </SvgText>
          </Svg>
        </View>
      </View>
    </View>
  );
}

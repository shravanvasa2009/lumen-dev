import { View } from 'react-native';
import Svg, { Defs, G, Line, Circle, Path, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import tokens from '@/theme/tokens.json';
import { useTheme } from '@/theme';

const WIDTH = 128;
const HEIGHT = 236;
const BALL = 76;
const TICKS = 60;
const TICK_OUTER = 36.5;
const TICK_INNER = 33.5;
// The board draws Light with a #D1D1D6 edge; the token set has no such step, so the frame uses the divider.
const FRAME_WIDTH = 3;

// The glow keeps its core solid to 70% and fades out to the edge, like the real Measure button.
const GLOW_STOPS = [
  [0, 1],
  [0.7, 1],
  [0.76, 0.92],
  [0.82, 0.42],
  [0.91, 0.16],
  [1, 0],
] as const;

const tickLines = Array.from({ length: TICKS }, (_, index) => {
  const angle = (index / TICKS) * 2 * Math.PI;
  const at = (radius: number) => ({
    x: BALL / 2 + radius * Math.sin(angle),
    y: BALL / 2 - radius * Math.cos(angle),
  });
  return { from: at(TICK_OUTER), to: at(TICK_INNER) };
});

type HomePreviewProps = { scheme: 'light' | 'dark'; measureLabel: string; caption: string };

// A small Home screen drawn in the named scheme's own colors, whatever theme the app is showing now.
export function HomePreview({ scheme, measureLabel, caption }: HomePreviewProps) {
  const { colors: current, spacing } = useTheme();
  const colors = tokens[scheme];
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={caption}
        style={{
          width: WIDTH,
          height: HEIGHT,
          borderRadius: 24,
          borderWidth: FRAME_WIDTH,
          borderColor: colors.line,
          backgroundColor: colors.bg,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 12,
            top: 16,
            width: 40,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: colors.surface3,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 12,
            top: 25,
            width: 72,
            height: 9,
            borderRadius: 4.5,
            backgroundColor: colors.text,
            opacity: 0.85,
          }}
        />
        <Svg
          width={BALL}
          height={BALL}
          viewBox={`0 0 ${BALL} ${BALL}`}
          style={{ position: 'absolute', left: 23, top: 42 }}
        >
          <Defs>
            <RadialGradient id={`ball-${scheme}`} cx="50%" cy="50%" fx="50%" fy="50%" r="50%">
              {GLOW_STOPS.map(([offset, opacity]) => (
                <Stop key={offset} offset={offset} stopColor={colors.measureCore} stopOpacity={opacity} />
              ))}
            </RadialGradient>
          </Defs>
          <Circle cx={BALL / 2} cy={BALL / 2} r={BALL / 2} fill={`url(#ball-${scheme})`} />
          <G stroke={colors.accent} strokeOpacity={0.55} strokeWidth={0.9} strokeLinecap="round">
            {tickLines.map(({ from, to }) => (
              <Line key={`${from.x}-${from.y}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            ))}
          </G>
        </Svg>
        <View
          style={{
            position: 'absolute',
            left: 23,
            top: 42,
            width: BALL,
            height: BALL,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText style={{ color: colors.text, fontSize: 10, lineHeight: 12, fontWeight: '600' }}>
            {measureLabel}
          </AppText>
        </View>
        <View
          style={{
            position: 'absolute',
            left: 9,
            top: 126,
            width: 104,
            height: 44,
            borderRadius: 12,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: 8,
              top: 9,
              width: 20,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: colors.text,
              opacity: 0.85,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 8,
              top: 26,
              width: 34,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.surface3,
            }}
          />
          <Svg width={44} height={20} viewBox="0 0 44 20" style={{ position: 'absolute', right: 8, top: 12 }}>
            <Path
              d="M2 13 L9 11 L16 14 L23 8 L30 10 L37 6 L42 7"
              fill="none"
              stroke={colors.buttonFill}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <View
          style={{
            position: 'absolute',
            left: 9,
            top: 176,
            width: 104,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.surface,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 7,
            top: 204,
            width: 108,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 6,
          }}
        >
          {[true, false, null, false, false].map((active, index) =>
            active === null ? (
              <View key={index} style={{ width: 14 }} />
            ) : (
              <View
                key={index}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: active ? colors.buttonFill : colors.textDim,
                  opacity: active ? 1 : 0.45,
                }}
              />
            ),
          )}
        </View>
        <View
          style={{
            position: 'absolute',
            left: 54,
            top: 197,
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.buttonFill,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Icon name={scheme === 'light' ? 'sun' : 'moon'} size={14} color={current.textDim} />
        <AppText variant="caption" style={{ fontWeight: '600' }}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}

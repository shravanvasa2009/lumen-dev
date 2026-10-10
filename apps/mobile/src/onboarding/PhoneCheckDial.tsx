import { View } from 'react-native';
import Svg, { G, Line, Path, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { PHONE_CHECK_MAX, PHONE_CHECK_TOTAL } from './phonePoints';

// Drawn in mockup 09's 230-unit square.
const BOX = 230;
const CENTER = BOX / 2;
const RADIUS = 93;
const BAND = 14;
const TICK_INNER = 103;
const TICK_OUTER = 106.5;
const LABEL_RADIUS = 112;
// Degrees clockwise from the top. The ring opens at the bottom and runs 270 degrees from the lower left.
const START = 225;
const SWEEP = 270;
const TICK_STEP = SWEEP / 20;
const SEGMENT_GAP = 1.5;
const LIT_DASH = '2.2 1.97';
const TIMING_DASH = '1.2 2.97';

const angleOf = (points: number) => START + (SWEEP * points) / PHONE_CHECK_TOTAL;
const pointAt = (angle: number, radius: number) => {
  const radians = (angle * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(radians), y: CENTER - radius * Math.cos(radians) };
};
const arc = (from: number, to: number) => {
  const a = pointAt(from, RADIUS);
  const b = pointAt(to, RADIUS);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

type PhoneCheckDialProps = {
  camera: number;
  locks: number;
  // Frame timing is only ever measured in practice, so its band stays unlit here.
  caption: string;
  accessibleLabel: string;
};

// The points the probe settled, as three bands (camera, locks, timing) around a ticked ring.
export function PhoneCheckDial({ camera, locks, caption, accessibleLabel }: PhoneCheckDialProps) {
  const { colors } = useTheme();
  const cameraEnd = PHONE_CHECK_MAX.camera;
  const locksEnd = cameraEnd + PHONE_CHECK_MAX.locks;
  const bands = [
    { from: 0, to: cameraEnd, earned: camera, color: colors.accent, dash: LIT_DASH },
    { from: cameraEnd, to: locksEnd, earned: locks, color: colors.illustrationTorso, dash: LIT_DASH },
    { from: locksEnd, to: PHONE_CHECK_TOTAL, earned: 0, color: colors.glyph, dash: TIMING_DASH },
  ];
  const ticks = Array.from({ length: 21 }, (_, index) => index).filter((index) => index % 10 !== 0);
  const labels = [
    { text: '0', angle: START },
    { text: String(Math.round(PHONE_CHECK_TOTAL / 2)), angle: angleOf(PHONE_CHECK_TOTAL / 2) },
    { text: String(PHONE_CHECK_TOTAL), angle: angleOf(PHONE_CHECK_TOTAL) },
  ];
  const total = camera + locks;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibleLabel}
      style={{ width: BOX, height: BOX, alignSelf: 'center' }}
    >
      <Svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} accessibilityElementsHidden>
        {bands.map(({ from, to, earned, color, dash }, index) => {
          // Interior joins leave a small gap so the bands read as separate parts.
          const start = angleOf(from) + (index === 0 ? 0 : SEGMENT_GAP);
          const end = angleOf(to) - (index === bands.length - 1 ? 0 : SEGMENT_GAP);
          const lit = start + ((end - start) * earned) / (to - from);
          return (
            <G key={from}>
              <Path
                d={arc(start, end)}
                fill="none"
                stroke={colors.surface3}
                strokeWidth={BAND}
                strokeDasharray={dash}
              />
              {earned > 0 ? (
                <Path
                  d={arc(start, lit)}
                  fill="none"
                  stroke={color}
                  strokeWidth={BAND}
                  strokeDasharray={dash}
                />
              ) : null}
            </G>
          );
        })}
        {ticks.map((index) => {
          const angle = START + TICK_STEP * index;
          const major = index === 5 || index === 15;
          const inner = pointAt(angle, TICK_INNER);
          const outer = pointAt(angle, TICK_OUTER + (major ? 1 : 0));
          return (
            <Line
              key={index}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={major ? colors.glyph : colors.line}
              strokeWidth={major ? 1.75 : 1.25}
              strokeLinecap="round"
            />
          );
        })}
        {labels.map(({ text, angle }) => {
          const at = pointAt(angle, LABEL_RADIUS);
          return (
            <SvgText
              key={text}
              x={at.x}
              y={at.y + 4}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight="600"
              fill={colors.textFaint}
            >
              {text}
            </SvgText>
          );
        })}
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 70, alignItems: 'center' }}>
        <AppText variant="vitalXL">{String(total)}</AppText>
        <AppText variant="caption" tone="textDim" style={{ fontWeight: '600' }}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}

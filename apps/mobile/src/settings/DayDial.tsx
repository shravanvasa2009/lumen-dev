import { View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import type { ClockTime } from '@/notifications/localTime';
import { useTheme } from '@/theme';

const SIZE = 120;
const CENTER = SIZE / 2;
const RADIUS = 48;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const HOURS = 24;
const TICK_OUTER = 40;
// Every sixth hour (midnight, 6, noon, 18) reaches further in so the quarters of the day read at a glance.
const TICK_INNER_QUARTER = 34;
const TICK_INNER = 36;
const QUARTER_HOURS = 6;
const DOT_RADIUS = 7;

const hoursOf = ({ hour, minute }: ClockTime) => hour + minute / 60;

// Clock angle in degrees from 12 o'clock, clockwise, with midnight at the top.
const degreesOf = (time: ClockTime) => (hoursOf(time) / HOURS) * 360;

const pointAt = (degrees: number, radius: number) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
};

type DayDialProps = {
  quietStart: ClockTime;
  quietEnd: ClockTime;
  // Null when the daily check is off: the dot goes and the centre says so.
  dailyTime: ClockTime | null;
  centerMain: string;
  centerSub: string;
  accessibilityLabel: string;
};

// A 24-hour face: a grey arc for the quiet hours, a teal dot at the daily reminder, midnight at the top.
export function DayDial({
  quietStart,
  quietEnd,
  dailyTime,
  centerMain,
  centerSub,
  accessibilityLabel,
}: DayDialProps) {
  const { colors } = useTheme();
  const quietHours = (hoursOf(quietEnd) - hoursOf(quietStart) + HOURS) % HOURS;
  const quietLength = (quietHours / HOURS) * CIRCUMFERENCE;
  const dot = dailyTime ? pointAt(degreesOf(dailyTime), RADIUS) : null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute' }}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={colors.surface2}
          strokeWidth={STROKE}
        />
        {quietLength > 0 ? (
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={colors.textDim}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${quietLength} ${CIRCUMFERENCE}`}
            transform={`rotate(${degreesOf(quietStart) - 90} ${CENTER} ${CENTER})`}
          />
        ) : null}
        <G stroke={colors.line} strokeWidth={1.25} strokeLinecap="round">
          {Array.from({ length: HOURS }, (_, hour) => {
            const degrees = (hour / HOURS) * 360;
            const from = pointAt(degrees, hour % QUARTER_HOURS === 0 ? TICK_INNER_QUARTER : TICK_INNER);
            const to = pointAt(degrees, TICK_OUTER);
            return <Line key={hour} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        </G>
        {dot ? (
          <Circle
            cx={dot.x}
            cy={dot.y}
            r={DOT_RADIUS}
            fill={colors.buttonFill}
            stroke={colors.surface}
            strokeWidth={2.5}
          />
        ) : null}
      </Svg>
      <AppText variant="title" style={{ fontWeight: '700', fontSize: 24, lineHeight: 28 }}>
        {centerMain}
      </AppText>
      <AppText variant="caption1" tone="textDim" style={{ fontWeight: '600' }}>
        {centerSub}
      </AppText>
    </View>
  );
}

import type { ReactNode } from 'react';
import { type ColorValue, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import tokens from '@/theme/tokens.json';

import { LumenMark } from './LumenMark';

// Sizes from the Widgets mockup: a 170 pt small widget with a 40 pt ring, a 72 pt lock-screen circle.
const SMALL_SIZE = 160;
const RING_SIZE = 40;
const RING_STROKE = 5;
const LOCK_CIRCLE_SIZE = 72;
const LOCK_RECT_HEIGHT = 72;
const WIDGET_RADIUS = 22;
// The mockup's buttons; they are previews, not touch targets, so control.minTarget does not apply.
const SMALL_PILL_HEIGHT = 32;
const MEDIUM_PILL_HEIGHT = 40;
const BUTTON_COLUMN_WIDTH = 124;
// Two thirds: the mockup's "check again" ring and lock-screen circle.
const PART_RING = 2 / 3;
// The mockup's see-through dark lock-screen card.
const GLASS_OPACITY = 0.85;

type Scheme = 'light' | 'dark';

// A ring drawn clockwise from the top, like the real widgets' rings.
function Ring({
  size,
  fraction,
  track,
  arc,
}: {
  size: number;
  fraction: number;
  track: ColorValue;
  arc: ColorValue;
}) {
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <Svg width={size} height={size} accessibilityElementsHidden>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={RING_STROKE} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={arc}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeLinecap={fraction < 1 ? 'round' : 'butt'}
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

function PreviewPill({ label, filled, height }: { label: string; filled: boolean; height: number }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        height,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: filled ? colors.buttonFill : colors.accentTint,
      }}
    >
      <AppText
        variant="subheadline"
        numberOfLines={1}
        style={{ color: filled ? colors.onButtonFill : colors.accent, fontWeight: '600' }}
      >
        {label}
      </AppText>
    </View>
  );
}

function WidgetFrame({ children, width, row }: { children: ReactNode; width?: number; row?: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        width,
        flexDirection: row ? 'row' : 'column',
        padding: spacing.lg - 2,
        gap: row ? spacing.lg : 0,
        borderRadius: WIDGET_RADIUS,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}

type SmallWidgetProps = { status: string; detail: string; action: string };

// Widgets mockup, small: the full up-to-date ring and the mark, the status, how long ago, and Check now.
export function SmallWidgetPreview({ status, detail, action }: SmallWidgetProps) {
  const { colors, spacing } = useTheme();
  return (
    <WidgetFrame width={SMALL_SIZE}>
      <View style={styles.spread}>
        <Ring size={RING_SIZE} fraction={1} track={colors.surface3} arc={colors.accent} />
        <LumenMark size={20} color={colors.accent} />
      </View>
      <View style={{ marginTop: spacing.lg }}>
        <AppText variant="headline">{status}</AppText>
        <AppText variant="caption1" tone="textDim">
          {detail}
        </AppText>
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <PreviewPill label={action} filled height={SMALL_PILL_HEIGHT} />
      </View>
    </WidgetFrame>
  );
}

type MediumWidgetProps = {
  name: string;
  // Null leaves the number out, as the real widgets do when values are hidden.
  reading: string | null;
  unit: string;
  status: string;
  detail: string;
  checkNow: string;
  fullScan: string;
};

// Widgets mockup, medium: the mark and name, the heart rate, the status and how long ago, and Check now over a tonal
// Full Scan.
export function MediumWidgetPreview({
  name,
  reading,
  unit,
  status,
  detail,
  checkNow,
  fullScan,
}: MediumWidgetProps) {
  const { colors, spacing } = useTheme();
  return (
    <WidgetFrame row>
      <View style={[styles.mediumInfo, { gap: spacing.sm }]}>
        <View style={[styles.logoRow, { gap: spacing.xs }]}>
          <LumenMark size={16} color={colors.accent} />
          <AppText variant="caption" tone="textDim">
            {name}
          </AppText>
        </View>
        {reading === null ? null : (
          <View style={[styles.readingRow, { gap: spacing.xs }]}>
            <AppText variant="vitalL">{reading}</AppText>
            <AppText variant="headline" tone="textDim">
              {unit}
            </AppText>
          </View>
        )}
        <View>
          <AppText variant="subheadline" style={styles.strong}>
            {status}
          </AppText>
          <AppText variant="caption" tone="textDim">
            {detail}
          </AppText>
        </View>
      </View>
      <View style={{ gap: spacing.sm, width: BUTTON_COLUMN_WIDTH, justifyContent: 'center' }}>
        <PreviewPill label={checkNow} filled height={MEDIUM_PILL_HEIGHT} />
        <PreviewPill label={fullScan} filled={false} height={MEDIUM_PILL_HEIGHT} />
      </View>
    </WidgetFrame>
  );
}

// A lock screen is dark behind its widgets in either app theme, so the lock previews take a scheme (dark by
// default) instead of the app theme.
function lockColors(scheme: Scheme | undefined) {
  return tokens[scheme ?? 'dark'];
}

// Widgets mockup, circular: the ring with the mark. The ring shows only how long ago the last check was.
export function LockCirclePreview({ scheme }: { scheme?: Scheme }) {
  const colors = lockColors(scheme);
  return (
    <View style={[styles.lockCircle, { backgroundColor: colors.surface2 }]}>
      <View style={StyleSheet.absoluteFill}>
        <Ring size={LOCK_CIRCLE_SIZE} fraction={PART_RING} track={colors.surface3} arc={colors.text} />
      </View>
      <LumenMark size={26} color={colors.text} />
    </View>
  );
}

type LockRectangleProps = { name: string; status: string; scheme?: Scheme };

// Widgets mockup, rectangular: the name and the status, no number (WID-2).
export function LockRectanglePreview({ name, status, scheme }: LockRectangleProps) {
  const { spacing } = useTheme();
  const colors = lockColors(scheme);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        height: LOCK_RECT_HEIGHT,
        paddingHorizontal: spacing.md + 2,
        borderRadius: spacing.lg,
        backgroundColor: colors.surface2,
      }}
    >
      <AppText variant="subheadline" style={[styles.strong, { color: colors.text }]}>
        {name}
      </AppText>
      <AppText variant="subheadline" style={{ color: colors.textDim }}>
        {status}
      </AppText>
    </View>
  );
}

type LockWidgetProps = { name: string; line: string; action: string };

// The Android lock-screen widget (LockWidget.kt): the ring and mark, the name, when the last check was, and Check
// now, on the see-through dark card. No status or value (WID-2).
export function AndroidLockPreview({ name, line, action }: LockWidgetProps) {
  const { spacing, radius } = useTheme();
  const colors = tokens.dark;
  return (
    <View style={[styles.logoRow, { padding: spacing.lg - 2, gap: spacing.md, borderRadius: WIDGET_RADIUS }]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: WIDGET_RADIUS, backgroundColor: colors.surface, opacity: GLASS_OPACITY },
        ]}
      />
      <View style={styles.lockRing}>
        <View style={StyleSheet.absoluteFill}>
          <Ring size={52} fraction={PART_RING} track={colors.surface3} arc={colors.text} />
        </View>
        <LumenMark size={24} color={colors.text} />
      </View>
      <View style={styles.mediumInfo}>
        <AppText variant="subheadline" style={[styles.strong, { color: colors.text }]}>
          {name}
        </AppText>
        <AppText variant="subheadline" style={{ color: colors.textDim }}>
          {line}
        </AppText>
      </View>
      <View
        style={{
          height: MEDIUM_PILL_HEIGHT,
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
          borderRadius: radius.pill,
          backgroundColor: colors.buttonFill,
        }}
      >
        <AppText
          variant="subheadline"
          numberOfLines={1}
          style={[styles.strong, { color: colors.onButtonFill }]}
        >
          {action}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  readingRow: { flexDirection: 'row', alignItems: 'baseline' },
  strong: { fontWeight: '600' },
  mediumInfo: { flex: 1, justifyContent: 'space-between' },
  lockCircle: {
    width: LOCK_CIRCLE_SIZE,
    height: LOCK_CIRCLE_SIZE,
    borderRadius: LOCK_CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockRing: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});

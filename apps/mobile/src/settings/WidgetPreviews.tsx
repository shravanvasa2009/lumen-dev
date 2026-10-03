import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import tokens from '@/theme/tokens.json';

import { LumenMark } from './LumenMark';

const SMALL_SIZE = 160;
const SMALL_MARK_SIZE = 34;
const MEDIUM_MARK_SIZE = 26;
const DOT_SIZE = 10;
const LOCK_CIRCLE_SIZE = 64;
// Sizes that mimic OS widget buttons; they are previews, not touch targets, so control.minTarget does not apply.
const PILL_MIN_HEIGHT = 40;
const BUTTON_COLUMN_WIDTH = 132;
const LOCK_DOT_SIZE = 10;
function PreviewPill({ label, filled }: { label: string; filled: boolean }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: PILL_MIN_HEIGHT,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: filled ? colors.accentFill : colors.line2,
        backgroundColor: filled ? colors.accentFill : 'transparent',
      }}
    >
      <AppText
        variant="caption"
        style={{ color: filled ? colors.onAccentFill : colors.text, fontWeight: '600' }}
      >
        {label}
      </AppText>
    </View>
  );
}

function WidgetFrame({ children, width }: { children: ReactNode; width?: number }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        width,
        padding: spacing.lg,
        gap: spacing.xs,
        borderRadius: radius.sheet,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}

type SmallWidgetProps = { status: string; detail: string; action: string };

export function SmallWidgetPreview({ status, detail, action }: SmallWidgetProps) {
  const { colors, spacing } = useTheme();
  return (
    <WidgetFrame width={SMALL_SIZE}>
      <View style={styles.spread}>
        <LumenMark size={SMALL_MARK_SIZE} color={colors.accent} />
        <View style={[styles.dot, { backgroundColor: colors.accent, marginTop: spacing.xs }]} />
      </View>
      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        <AppText variant="headline">{status}</AppText>
        <AppText variant="caption" tone="textDim">
          {detail}
        </AppText>
      </View>
      <PreviewPill label={action} filled />
    </WidgetFrame>
  );
}

type MediumWidgetProps = {
  name: string;
  // Null leaves the reading row out, as the Android widget does when values are hidden.
  reading: string | null;
  unit: string;
  status: string;
  checkNow: string;
  fullScan: string;
};

export function MediumWidgetPreview({ name, reading, unit, status, checkNow, fullScan }: MediumWidgetProps) {
  const { colors, spacing } = useTheme();
  return (
    <WidgetFrame>
      <View style={[styles.mediumColumns, { gap: spacing.md }]}>
        <View style={[styles.mediumInfo, { gap: spacing.xs }]}>
          <View style={[styles.logoRow, { gap: spacing.sm }]}>
            <LumenMark size={MEDIUM_MARK_SIZE} color={colors.accent} />
            <AppText tone="textDim">{name}</AppText>
          </View>
          <View style={styles.mediumReading}>
            {reading === null ? null : (
              <View style={[styles.readingRow, { gap: spacing.sm }]}>
                <AppText variant="display">{reading}</AppText>
                <AppText variant="headline" tone="textDim">
                  {unit}
                </AppText>
              </View>
            )}
            <AppText tone="textDim">{status}</AppText>
          </View>
        </View>
        <View style={{ gap: spacing.sm, width: BUTTON_COLUMN_WIDTH, justifyContent: 'center' }}>
          <PreviewPill label={checkNow} filled />
          <PreviewPill label={fullScan} filled={false} />
        </View>
      </View>
    </WidgetFrame>
  );
}

type Scheme = 'light' | 'dark';

// A lock screen looks the same in either app theme, so the lock-screen route passes its own scheme.
export function LockCirclePreview({ scheme }: { scheme?: Scheme }) {
  const theme = useTheme();
  const colors = scheme ? tokens[scheme] : theme.colors;
  return (
    <View style={[styles.lockCircle, { backgroundColor: colors.surface2 }]}>
      <LumenMark size={SMALL_MARK_SIZE + 8} color={colors.text} />
      <View style={[styles.lockDot, { backgroundColor: colors.accent }]} />
    </View>
  );
}

type LockRectangleProps = { name: string; status: string; scheme?: Scheme };

export function LockRectanglePreview({ name, status, scheme }: LockRectangleProps) {
  const { colors: themeColors, radius, spacing } = useTheme();
  const colors = scheme ? tokens[scheme] : themeColors;
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        height: LOCK_CIRCLE_SIZE,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.card,
        backgroundColor: colors.surface2,
      }}
    >
      <AppText variant="headline" style={{ color: colors.text }}>
        {name}
      </AppText>
      <AppText variant="caption" style={{ color: colors.textDim }}>
        {status}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  readingRow: { flexDirection: 'row', alignItems: 'baseline' },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  lockCircle: {
    width: LOCK_CIRCLE_SIZE,
    height: LOCK_CIRCLE_SIZE,
    borderRadius: LOCK_CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: LOCK_DOT_SIZE,
    height: LOCK_DOT_SIZE,
    borderRadius: LOCK_DOT_SIZE / 2,
  },
  mediumColumns: { flexDirection: 'row', alignItems: 'stretch' },
  mediumInfo: { flex: 1, justifyContent: 'space-between' },
  mediumReading: { gap: 2 },
});

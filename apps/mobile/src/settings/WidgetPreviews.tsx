import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import tokens from '@/theme/tokens.json';

import { LumenMark } from './LumenMark';

const SMALL_SIZE = 160;
const MARK_SIZE = 34;
const DOT_SIZE = 10;
const LOCK_CIRCLE_SIZE = 64;

function PreviewPill({ label, filled }: { label: string; filled: boolean }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 32,
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
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        width,
        padding: spacing.lg,
        gap: spacing.xs,
        borderRadius: 24,
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
        <LumenMark size={MARK_SIZE} color={colors.accentFill} />
        <View style={[styles.dot, { backgroundColor: colors.accentFill }]} />
      </View>
      <View style={{ marginTop: spacing.sm, gap: 2 }}>
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
  reading: string;
  unit: string;
  status: string;
  checkNow: string;
  fullScan: string;
};

export function MediumWidgetPreview({ name, reading, unit, status, checkNow, fullScan }: MediumWidgetProps) {
  const { colors, spacing } = useTheme();
  return (
    <WidgetFrame>
      <View style={styles.spread}>
        <View style={[styles.logoRow, { gap: spacing.sm }]}>
          <LumenMark size={MARK_SIZE} color={colors.accentFill} />
          <AppText tone="textDim">{name}</AppText>
        </View>
        <View style={{ gap: spacing.sm, width: 132 }}>
          <PreviewPill label={checkNow} filled />
          <PreviewPill label={fullScan} filled={false} />
        </View>
      </View>
      <View style={[styles.readingRow, { gap: spacing.sm }]}>
        <AppText variant="display">{reading}</AppText>
        <AppText variant="headline" tone="textDim">
          {unit}
        </AppText>
      </View>
      <AppText tone="textDim">{status}</AppText>
    </WidgetFrame>
  );
}

type Scheme = 'light' | 'dark';

// A lock screen looks the same in either app theme, so the lock-screen route passes its own scheme.
export function LockCirclePreview({ scheme }: { scheme?: Scheme }) {
  const theme = useTheme();
  const colors = scheme ? tokens[scheme] : theme.colors;
  return (
    <View style={[styles.lockCircle, { backgroundColor: colors.surface3, borderColor: colors.line }]}>
      <LumenMark size={MARK_SIZE + 8} color={colors.text} />
    </View>
  );
}

type LockRectangleProps = { name: string; status: string; scheme?: Scheme };

export function LockRectanglePreview({ name, status, scheme }: LockRectangleProps) {
  const { colors: themeColors, spacing } = useTheme();
  const colors = scheme ? tokens[scheme] : themeColors;
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        height: LOCK_CIRCLE_SIZE,
        paddingHorizontal: spacing.lg,
        borderRadius: 18,
        backgroundColor: colors.surface3,
        borderColor: colors.line,
        borderWidth: 1,
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
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, marginTop: 4 },
  lockCircle: {
    width: LOCK_CIRCLE_SIZE,
    height: LOCK_CIRCLE_SIZE,
    borderRadius: LOCK_CIRCLE_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

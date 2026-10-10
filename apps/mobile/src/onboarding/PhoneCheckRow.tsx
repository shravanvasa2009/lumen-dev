import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';
import { useReduceMotion } from '@/theme/motion';

import type { RowStatus } from './capabilityRows';

const TILE = 36;
const MARK = 14;

type PhoneCheckRowProps = {
  icon: IconName;
  tile: { fill: string; glyph: string };
  title: string;
  status: RowStatus;
  // The settled reading, such as "60 fps".
  value: string;
  // What the mark says to a screen reader once the row is settled.
  markLabel: string;
  // Rows whose probe could not run say so instead of showing a reading.
  unchecked: boolean;
  last?: boolean;
  children?: ReactNode;
};

// One capability: an icon tile, its name, the reading with a state mark, and an optional picture of it below.
export function PhoneCheckRow({
  icon,
  tile,
  title,
  status,
  value,
  markLabel,
  unchecked,
  last = false,
  children,
}: PhoneCheckRowProps) {
  const { colors, spacing, control } = useTheme();
  const reduceMotion = useReduceMotion();
  const settled = !unchecked && status !== 'checking';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomColor: colors.line,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }}
    >
      <View
        style={{
          width: TILE,
          height: TILE,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tile.fill,
        }}
      >
        <Icon name={icon} size={control.chevronSize} color={tile.glyph} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TILE }}>
          <AppText style={{ flex: 1 }}>{title}</AppText>
          {settled ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, flexShrink: 1 }}>
              <AppText tone="textDim" style={{ fontVariant: ['tabular-nums'], flexShrink: 1 }}>
                {value}
              </AppText>
              <View accessible accessibilityRole="image" accessibilityLabel={markLabel}>
                {status === 'pass' ? (
                  <Icon name="check" size={18} color={colors.accent} />
                ) : (
                  <View
                    style={{
                      width: MARK,
                      height: MARK,
                      borderRadius: MARK / 2,
                      borderWidth: 2,
                      borderColor: status === 'fail' ? colors.flag : colors.line2,
                      backgroundColor: status === 'fail' ? colors.flag : 'transparent',
                    }}
                  />
                )}
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
              {status === 'checking' && !reduceMotion ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : null}
              <AppText
                variant="subheadline"
                tone={status === 'checking' ? 'accent' : 'textFaint'}
                style={status === 'checking' ? { fontWeight: '600' } : undefined}
              >
                {value}
              </AppText>
            </View>
          )}
        </View>
        {settled ? children : null}
      </View>
    </View>
  );
}

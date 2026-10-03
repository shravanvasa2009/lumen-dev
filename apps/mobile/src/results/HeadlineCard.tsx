import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

type HeadlineCardProps = { fill: string; edge: string; children: ReactNode };

// The tint fades into the surface colour so the text always sits on one of two light (or two dark) fills
// that the contrast check already covers.
export function HeadlineCard({ fill, edge, children }: HeadlineCardProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        borderColor: edge,
        borderWidth: 1,
        borderRadius: radius.card,
        overflow: 'hidden',
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      <Svg
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <LinearGradient id="headlineFill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={fill} />
            <Stop offset="1" stopColor={colors.surface} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#headlineFill)" />
      </Svg>
      {children}
    </View>
  );
}

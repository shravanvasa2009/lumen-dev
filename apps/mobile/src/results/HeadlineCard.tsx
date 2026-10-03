import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

type HeadlineCardProps = { fill: string; edge: string; children: ReactNode };

// The tint fades into the surface colour so the text always sits on one of two light (or two dark) fills
// that the contrast check already covers.
export function HeadlineCard({ fill, edge, children }: HeadlineCardProps) {
  const { colors, radius, spacing } = useTheme();
  // Percent sizes left the gradient short of the right edge on Android, so it is drawn at the measured size.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      testID="headline-card"
      onLayout={(event) => setSize(event.nativeEvent.layout)}
      style={{
        borderColor: edge,
        borderWidth: 1,
        borderRadius: radius.card,
        overflow: 'hidden',
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      {size ? (
        <Svg
          width={size.width}
          height={size.height}
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
          <Rect width={size.width} height={size.height} fill="url(#headlineFill)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import tokens from '@/theme/tokens.json';
import { useTheme } from '@/theme';

const WIDTH = 118;
const HEIGHT = 210;
const MEASURE_SIZE = 62;
const ROW_HEIGHT = 30;

type HomePreviewProps = { scheme: 'light' | 'dark'; measureLabel: string; caption: string };

// A small Home screen drawn in the named scheme's own colors, whatever theme the app is showing now.
export function HomePreview({ scheme, measureLabel, caption }: HomePreviewProps) {
  const { spacing, radius } = useTheme();
  const colors = tokens[scheme];
  const rowStyle = {
    height: ROW_HEIGHT,
    borderRadius: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
  };
  return (
    <View style={styles.preview}>
      <View
        style={{
          width: WIDTH,
          height: HEIGHT,
          borderRadius: radius.sheet,
          backgroundColor: colors.bg,
          borderColor: colors.line,
          borderWidth: 1,
          padding: spacing.md,
          gap: spacing.sm,
          alignItems: 'stretch',
        }}
      >
        <View
          style={[
            styles.measure,
            { width: MEASURE_SIZE, height: MEASURE_SIZE, backgroundColor: colors.badgeCheckedBg },
          ]}
        >
          <AppText variant="caption" style={{ color: colors.text, fontWeight: '700' }}>
            {measureLabel}
          </AppText>
        </View>
        <View style={rowStyle} />
        <View style={rowStyle} />
      </View>
      <AppText tone="textDim">{caption}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: 8 },
  measure: {
    alignSelf: 'center',
    borderRadius: MEASURE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

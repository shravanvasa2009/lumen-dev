import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

// The amber card is the strongest tone this screen uses; red stays on the emergency screen (SAFE-1).
export function SafetyCard({ text }: { text: string }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.flagBg,
        borderRadius: radius.card,
        padding: spacing.lg,
      }}
    >
      <Svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path d="M12 3 22 20H2Z" fill={colors.flag} />
        <Path d="M12 9.5v5M12 17v.5" stroke={colors.flagBg} strokeWidth={2} strokeLinecap="round" />
      </Svg>
      <AppText variant="headline" style={{ flex: 1, color: colors.flag }}>
        {text}
      </AppText>
    </View>
  );
}

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Confidence } from '@lumen/core';

import { useTheme } from '@/theme';

const filledDots: Record<Confidence, number> = { high: 3, moderate: 2, low: 1 };

// The words sit in the accessibility label so confidence is never carried by the dots' colour alone.
export function ConfidenceDots({ confidence }: { confidence: Confidence }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const words = {
    high: t('confidence.high'),
    moderate: t('confidence.moderate'),
    low: t('confidence.low'),
  }[confidence];
  return (
    <View
      accessible
      accessibilityLabel={words}
      testID="confidence-dots"
      style={{ flexDirection: 'row', gap: spacing.xs }}
    >
      {[1, 2, 3].map((position) => (
        <View
          key={position}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: position <= filledDots[confidence] ? colors.accent : colors.line2,
          }}
        />
      ))}
    </View>
  );
}

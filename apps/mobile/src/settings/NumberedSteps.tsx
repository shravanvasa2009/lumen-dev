import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

const NUMBER_WIDTH = 24;

export function NumberedSteps({ steps }: { steps: readonly string[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {steps.map((step, index) => (
        // One readable element per step, so a screen reader says the number with the text.
        <View
          key={step}
          accessible
          accessibilityLabel={`${index + 1}. ${step}`}
          style={{ flexDirection: 'row', gap: spacing.sm }}
        >
          <AppText tone="textDim" style={{ width: NUMBER_WIDTH }} importantForAccessibility="no">
            {`${index + 1}.`}
          </AppText>
          <AppText style={{ flex: 1 }} importantForAccessibility="no">
            {step}
          </AppText>
        </View>
      ))}
    </View>
  );
}

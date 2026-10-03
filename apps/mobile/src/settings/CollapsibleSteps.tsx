import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import { NumberedSteps } from './NumberedSteps';

type CollapsibleStepsProps = { title: string; steps: readonly string[] };

export function CollapsibleSteps({ title, steps }: CollapsibleStepsProps) {
  const { colors, spacing, radius, control } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          minHeight: control.minTarget,
          paddingHorizontal: spacing.lg,
        }}
      >
        <AppText variant="headline" style={{ flex: 1 }} importantForAccessibility="no">
          {title}
        </AppText>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={control.chevronSize} color={colors.text} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ padding: spacing.lg, paddingTop: spacing.xs }}>
          <NumberedSteps steps={steps} />
        </View>
      ) : null}
    </View>
  );
}

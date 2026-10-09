import { useEffect, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Icon } from '@/components/Icon';
import { Reveal, Settle } from '@/components/Reveal';
import { useTheme } from '@/theme';
import { timingConfig, useReduceMotion } from '@/theme/motion';

import { NumberedSteps } from './NumberedSteps';

type CollapsibleStepsProps = { title: string; steps: readonly string[] };

export function CollapsibleSteps({ title, steps }: CollapsibleStepsProps) {
  const { colors, spacing, radius, control } = useTheme();
  const [open, setOpen] = useState(false);
  const reduceMotion = useReduceMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, timingConfig(reduceMotion));
  }, [open, reduceMotion, turn]);
  // The chevron points down when closed and turns to point up when open.
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${90 - 180 * turn.value}deg` }] }));
  return (
    <Settle
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      <PressableScale
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
        <Animated.View style={chevronStyle}>
          <Icon name="chevron" size={control.chevronSize} color={colors.text} />
        </Animated.View>
      </PressableScale>
      {open ? (
        <Reveal style={{ padding: spacing.lg, paddingTop: spacing.xs }}>
          <NumberedSteps steps={steps} />
        </Reveal>
      ) : null}
    </Settle>
  );
}

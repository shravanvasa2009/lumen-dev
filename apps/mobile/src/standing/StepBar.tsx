import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { STEP_COUNT } from '@/standing/protocol';
import { useTheme } from '@/theme';

const SEGMENT_HEIGHT = 6;

type StepBarProps = {
  // 1-based number of the current step; 0 before the test starts.
  step: number;
  stopped: boolean;
};

// Five segments, one per step of the protocol: finished ones solid, the current one bright.
export function StepBar({ step, stopped }: StepBarProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const names = [
    t('standing.stage.lying'),
    t('standing.bar.baseline'),
    t('standing.stage.standing'),
    t('standing.bar.final'),
    t('standing.bar.done'),
  ];
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs + 2 }}>
      {names.map((name, index) => {
        const finished = index + 1 < step || (step === STEP_COUNT && index + 1 === step);
        const current = index + 1 === step && !finished;
        const alert = stopped && current;
        const fill = alert ? colors.alertFill : finished ? colors.buttonFill : colors.accent;
        const labelTint = alert ? colors.alertText : finished || current ? colors.accent : colors.textFaint;
        return (
          <View key={name} style={{ flex: 1, gap: spacing.xs }}>
            <View
              style={{
                height: SEGMENT_HEIGHT,
                borderRadius: radius.pill,
                backgroundColor: finished || current ? fill : colors.surface3,
              }}
            />
            <AppText
              numberOfLines={1}
              style={{ fontSize: 11, lineHeight: 13, fontWeight: '600', color: labelTint }}
            >
              {name}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

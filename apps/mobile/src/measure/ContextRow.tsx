import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

type ContextRowProps = {
  label: string;
  icon: IconName;
  selected: boolean;
  last: boolean;
  onToggle: () => void;
};

export function ContextRow({ label, icon, selected, last, onToggle }: ContextRowProps) {
  const { colors, spacing, control } = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: control.minTarget,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Icon name={icon} size={22} color={colors.accent} />
      <AppText style={{ flex: 1 }}>{label}</AppText>
      {selected ? <Icon name="check" size={control.chevronSize} color={colors.accent} /> : null}
    </PressableScale>
  );
}

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

type ContextChipProps = {
  label: string;
  icon?: IconName;
  selected: boolean;
  onToggle: () => void;
};

export function ContextChip({ label, icon, selected, onToggle }: ContextChipProps) {
  const { colors, spacing, radius, control } = useTheme();
  const textColor = selected ? colors.badgeCheckedFg : colors.text;
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: control.minTarget,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.badgeCheckedBg : colors.surface2,
      }}
    >
      {icon ? <Icon name={icon} size={18} color={textColor} /> : null}
      <AppText style={{ color: textColor }}>{label}</AppText>
    </PressableScale>
  );
}

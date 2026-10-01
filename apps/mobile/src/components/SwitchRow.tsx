import { Switch } from 'react-native';

import { useTheme } from '@/theme';

import { ListRow } from './ListRow';

type SwitchRowProps = { title: string; value: boolean; onChange: (value: boolean) => void; last?: boolean };

export function SwitchRow({ title, value, onChange, last }: SwitchRowProps) {
  const { colors } = useTheme();
  return (
    <ListRow
      title={title}
      last={last}
      trailing={
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.surface3, true: colors.accentFill }}
          ios_backgroundColor={colors.surface3}
          thumbColor={value ? undefined : colors.textFaint}
        />
      }
    />
  );
}

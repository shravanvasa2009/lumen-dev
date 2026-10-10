import { View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

const tileSize = 30;

// A destructive row gets the neutral tile so teal stays the only accent in the list.
export function IconTile({ name, neutral = false }: { name: IconName; neutral?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: tileSize,
        height: tileSize,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: neutral ? colors.textDim : colors.buttonFill,
      }}
    >
      <Icon name={name} size={18} color={neutral ? colors.bg : colors.onButtonFill} />
    </View>
  );
}

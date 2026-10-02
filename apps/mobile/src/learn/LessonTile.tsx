import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { Lesson } from './lessons';

// No theme token fits: radius.card is 16 and the control sizes are 44 and 52, and the mockup tile is 48 with
// a 12 corner.
const TILE_SIZE = 48;
const TILE_RADIUS = 12;

// Tile colours come from theme tokens only; red stays reserved for the emergency screen (SAFE-1).
export function LessonTile({ tone }: { tone: Lesson['tone'] }) {
  const { colors, control } = useTheme();
  const fill = { accent: colors.accentFill, flag: colors.flag, public: colors.badgePublicFg }[tone];
  return (
    <View
      style={{
        width: TILE_SIZE,
        height: TILE_SIZE,
        borderRadius: TILE_RADIUS,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="learn" size={control.chevronSize + 4} color={colors.bg} />
    </View>
  );
}

import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';

import { useTheme } from '@/theme';
import { motion } from '@/theme/motion';

type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  // Spoken label of the dimmed area; a tap there dismisses the sheet.
  dismissLabel: string;
  children: ReactNode;
};

// The in-app modal sheet. The Modal fades the dimmed area in and out natively, and the panel slides up on
// the UI thread (instant under Reduce Motion). The content unmounts the moment `visible` is false and no
// button waits for an animation, so SafetySheet's route to the emergency screen is never delayed.
export function BottomSheet({ visible, onDismiss, dismissLabel, children }: BottomSheetProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel={dismissLabel}
          onPress={onDismiss}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: colors.scrim,
          }}
        />
        <Animated.View
          entering={SlideInDown.duration(motion.sheetMs).reduceMotion(ReduceMotion.System)}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderWidth: 1,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            padding: spacing.xxl,
            paddingBottom: spacing.xxxl,
            gap: spacing.lg,
          }}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

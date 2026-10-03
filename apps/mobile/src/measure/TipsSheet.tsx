import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { ReminderRows } from './reminders';

type TipsSheetProps = { visible: boolean; onDismiss: () => void };

// Opened from the "?" on Capture; the reading keeps running behind it.
export function TipsSheet({ visible, onDismiss }: TipsSheetProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel={t('safety.dismiss')}
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
        <View
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
          <AppText variant="title" accessibilityRole="header">
            {t('precheck.reminders')}
          </AppText>
          <ReminderRows />
          <Button label={t('safety.dismiss')} variant="secondary" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

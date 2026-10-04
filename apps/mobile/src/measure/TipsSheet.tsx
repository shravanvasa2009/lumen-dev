import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';

import { ReminderRows } from './reminders';

type TipsSheetProps = { visible: boolean; onDismiss: () => void };

// Opened from the "?" on Capture; the reading keeps running behind it.
export function TipsSheet({ visible, onDismiss }: TipsSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} dismissLabel={t('safety.dismiss')}>
      <AppText variant="title" accessibilityRole="header">
        {t('precheck.reminders')}
      </AppText>
      <ReminderRows />
      <Button label={t('safety.dismiss')} variant="secondary" onPress={onDismiss} />
    </BottomSheet>
  );
}

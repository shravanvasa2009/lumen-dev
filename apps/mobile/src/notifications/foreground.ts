import { type Notification, type NotificationBehavior, setNotificationHandler } from 'expo-notifications';

import { ID_PREFIXES } from './plan';

// expo-notifications 57: without a handler, an alert that arrives while Lumen is open is not shown at all.
// That is exactly when standing-test alerts fire, so every Lumen alert shows; only those play a sound,
// because a reading is due within seconds.
// https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#setnotificationhandlerhandler
export async function foregroundBehavior(notification: Notification): Promise<NotificationBehavior> {
  const isStanding = notification.request.identifier.startsWith(`${ID_PREFIXES.standing}-`);
  return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: isStanding, shouldSetBadge: false };
}

export function showNotificationsInForeground(): void {
  setNotificationHandler({
    // eslint-disable-next-line no-restricted-syntax -- the field name belongs to expo-notifications' handler type.
    handleNotification: foregroundBehavior,
    // eslint-disable-next-line no-restricted-syntax -- the field name belongs to expo-notifications' handler type.
    handleError: (notificationId, error) =>
      console.warn(`Notification ${notificationId} could not be shown in the app: ${error.message}`),
  });
}

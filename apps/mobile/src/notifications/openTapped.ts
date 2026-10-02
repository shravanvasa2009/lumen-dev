import { DEFAULT_ACTION_IDENTIFIER, useLastNotificationResponse } from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

import { redirectSystemPath } from '../deepLinks';

// Opens the screen a tapped notification points at, including the tap that launched the app.
export function useOpenTappedNotification(): void {
  const response = useLastNotificationResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
    const link = response.notification.request.content.data?.url;
    if (typeof link === 'string') router.push(redirectSystemPath({ path: link }) as Href);
  }, [response]);
}

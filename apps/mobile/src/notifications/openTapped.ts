import { DEFAULT_ACTION_IDENTIFIER, useLastNotificationResponse } from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

// §9.6 deep links, mapped to the screens they open. Step 3's +native-intent takes over lumen:// links
// from outside the app; until then, notification taps are resolved here.
const LINK_PATHS: Readonly<Record<string, string>> = {
  check: '/measure/precheck',
  standing: '/measure/standing-test',
};

export function appPathFor(link: string): string {
  const match = /^lumen:\/\/([^?#]*)\??([^#]*)/.exec(link);
  if (!match) return link;
  const [, host = '', query = ''] = match;
  const path = LINK_PATHS[host] ?? `/${host}`;
  if (host !== 'check') return query ? `${path}?${query}` : path;
  return `${path}?mode=${query.split('&').includes('mode=full') ? 'full' : 'quick'}`;
}

// Opens the screen a tapped notification points at, including the tap that launched the app.
export function useOpenTappedNotification(): void {
  const response = useLastNotificationResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
    const link = response.notification.request.content.data?.url;
    if (typeof link === 'string') router.push(appPathFor(link) as Href);
  }, [response]);
}

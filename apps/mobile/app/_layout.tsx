import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/i18n';
import { StorageErrorScreen } from '@/components/StorageErrorScreen';
import { DemoStrip } from '@/demo/DemoStrip';
import { useSavedLanguage } from '@/i18n/language';
import { showNotificationsInForeground } from '@/notifications/foreground';
import { useOpenTappedNotification } from '@/notifications/openTapped';
import { useTheme } from '@/theme';

showNotificationsInForeground();

// expo-router installs an error boundary only from a route's ErrorBoundary export; the root layout's covers
// every screen, so a failed read of saved data shows a message with a retry instead of closing the app.
// https://docs.expo.dev/router/error-handling/
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <StorageErrorScreen retry={retry} />;
}

// Pushed screens show a centred nav-bar title and a teal back chevron, as the mockups do; RouteShell sets the title.
export default function RootLayout() {
  const { colors, isDark, type } = useTheme();
  useOpenTappedNotification();
  useSavedLanguage();
  return (
    <DemoStrip>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // Screens that still draw their own body title leave the nav-bar title empty.
          title: '',
          headerTitleAlign: 'center',
          headerTitleStyle: {
            color: colors.text,
            fontSize: type.headline.size,
            fontWeight: type.headline.weight,
          },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="follow-up"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
          }}
        />
      </Stack>
    </DemoStrip>
  );
}

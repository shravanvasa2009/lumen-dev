import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/i18n';
import { showNotificationsInForeground } from '@/notifications/foreground';
import { useOpenTappedNotification } from '@/notifications/openTapped';
import { useTheme } from '@/theme';

showNotificationsInForeground();

// Pushed screens show a centred nav-bar title and a teal back chevron, as the mockups do; RouteShell sets the title.
export default function RootLayout() {
  const { colors, isDark, type } = useTheme();
  useOpenTappedNotification();
  return (
    <>
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
    </>
  );
}

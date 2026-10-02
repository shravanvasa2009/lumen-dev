import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/i18n';
import { useTheme } from '@/theme';

// Each screen draws its own translated title in its body, so the native header only carries the back button.
export default function RootLayout() {
  const { colors, isDark, radius } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Mockup 34. formSheet is a bottom sheet on iOS and Android per the native-stack types;
            https://docs.expo.dev/router/advanced/modals/ */}
        <Stack.Screen
          name="follow-up"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: [0.75, 1],
            sheetCornerRadius: radius.sheet,
          }}
        />
      </Stack>
    </>
  );
}

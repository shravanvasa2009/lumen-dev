import { useRouter } from 'expo-router';
import { createContext, type ReactNode, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { type EdgeInsets, SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { exitDemo, useDemoActive } from './demoSession';

const WindowInsetsContext = createContext<EdgeInsets | null>(null);

// The device's real insets. A native sheet covers the demo bar, so it must not use the reduced insets that
// the screens under the bar see.
export function useWindowInsets(): EdgeInsets {
  const reduced = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? reduced;
}

// The device's real bottom inset for a sheet drawn over everything, 0 where no provider is mounted (tests).
export function useWindowBottomInset(): number {
  const real = useContext(WindowInsetsContext);
  const reduced = useContext(SafeAreaInsetsContext);
  return (real ?? reduced)?.bottom ?? 0;
}

// §8.5: a persistent demo bar on every screen. It sits under the navigator and pads for the bottom inset
// itself, so the screens above it see a bottom inset of 0 and do not pad for it twice. The tree is the same
// with Demo on or off, so entering or leaving Demo never remounts the navigator.
export function DemoStrip({ children }: { children: ReactNode }) {
  const demo = useDemoActive();
  const insets = useSafeAreaInsets();
  return (
    <WindowInsetsContext.Provider value={insets}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <SafeAreaInsetsContext.Provider value={demo ? { ...insets, bottom: 0 } : insets}>
            {children}
          </SafeAreaInsetsContext.Provider>
        </View>
        {demo ? <ExitBar bottomInset={insets.bottom} /> : null}
      </View>
    </WindowInsetsContext.Provider>
  );
}

function ExitBar({ bottomInset }: { bottomInset: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingHorizontal: spacing.screen,
        paddingBottom: bottomInset,
        backgroundColor: colors.surface3,
        borderTopColor: colors.line2,
        borderTopWidth: 1,
      }}
    >
      <AppText variant="caption" style={{ flex: 1, fontWeight: '600' }}>
        {t('demo.bar')}
      </AppText>
      <Button
        label={t('demo.exit')}
        variant="link"
        onPress={() => {
          exitDemo();
          router.replace('/welcome');
        }}
      />
    </View>
  );
}

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import { exitDemo, useDemoActive } from './demoSession';

// §8.5: a persistent "Demo data" banner on every screen. It sits under the navigator and takes over the
// bottom safe-area inset, so the screens above it do not pad for the same inset twice. The tree is the same
// with Demo on or off, so entering or leaving Demo never remounts the navigator.
export function DemoStrip({ children }: { children: ReactNode }) {
  const demo = useDemoActive();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider value={demo ? { ...insets, bottom: 0 } : insets}>
          {children}
        </SafeAreaInsetsContext.Provider>
      </View>
      {demo ? <ExitBar bottomInset={insets.bottom} /> : null}
    </View>
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

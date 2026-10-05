import { Tabs } from 'expo-router';
import { Easing, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CareTabButton, tabRowHeight } from '@/components/CareTabButton';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { motion, useReduceMotion } from '@/theme/motion';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, type } = useTheme();
  const reduceMotion = useReduceMotion();
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'fade',
        // Bottom tabs run on React Native's Animated, so the 200 ms ease-out token is spelled with its Easing.
        transitionSpec: {
          animation: 'timing',
          config: { duration: motion.durationMs, easing: Easing.out(Easing.cubic) },
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: tabRowHeight(type.caption.lineHeight, fontScale) + bottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => <Icon name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: t('tabs.trends'),
          tabBarIcon: ({ color, size }) => <Icon name="trends" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          lazy: true,
          title: t('tabs.care'),
          tabBarAccessibilityLabel: t('tabs.careLabel'),
          tabBarButton: ({ onPress, onLongPress, testID, 'aria-selected': selected }) => (
            <CareTabButton
              label={t('tabs.care')}
              accessibilityLabel={t('tabs.careLabel')}
              selected={selected === true}
              onPress={onPress}
              onLongPress={onLongPress}
              testID={testID}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t('tabs.learn'),
          tabBarIcon: ({ color, size }) => <Icon name="learn" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => <Icon name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

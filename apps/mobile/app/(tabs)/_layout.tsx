import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
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

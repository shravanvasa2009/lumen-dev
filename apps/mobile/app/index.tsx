import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title: t('app.name') }} />
      <Text style={[styles.title, { color: colors.text }]}>{t('app.name')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
});

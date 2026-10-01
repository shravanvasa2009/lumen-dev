import { Stack } from 'expo-router';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { themeFor } from '@/theme';

export default function HomeScreen() {
  const theme = themeFor(useColorScheme());
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Stack.Screen options={{ title: 'Lumen' }} />
      <Text style={[styles.title, { color: theme.text }]}>Lumen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
});

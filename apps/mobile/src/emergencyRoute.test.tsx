import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootLayout from '../app/_layout';

const mockScreens: { name: string; options?: { animation?: string } }[] = [];

jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: unknown }) => children;
  Stack.Screen = (screen: { name: string; options?: { animation?: string } }) => {
    mockScreens.push(screen);
    return null;
  };
  return { Stack };
});

describe('root stack', () => {
  it('opens the emergency screen with no transition (SAFE-1)', () => {
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <RootLayout />
      </SafeAreaProvider>,
    );
    expect(mockScreens.find((screen) => screen.name === 'emergency')?.options?.animation).toBe('none');
  });
});

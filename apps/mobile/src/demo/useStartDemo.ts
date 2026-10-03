import { useRouter } from 'expo-router';

import { enterDemo } from './demoSession';

export function useStartDemo(): () => void {
  const router = useRouter();
  return () => {
    enterDemo();
    router.replace('/');
  };
}

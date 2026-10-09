import { Stack } from 'expo-router';

import { stackAnimation, useReduceMotion } from '@/theme/motion';

// A nested stack does not inherit the root's animation, so onboarding sets the same one.
export default function OnboardingLayout() {
  const reduceMotion = useReduceMotion();
  return <Stack screenOptions={{ headerShown: false, animation: stackAnimation(reduceMotion) }} />;
}

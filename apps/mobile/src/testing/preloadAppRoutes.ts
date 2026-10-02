import { getMockContext } from 'expo-router/testing-library';

// renderRouter requires a route file the first time a test opens it, so the first test in a file paid for
// loading the app's module graph inside its 5 s budget and timed out when the machine was busy (order
// C.AB_TASK-mobile-test-timeouts). Called at the top of a test file, this loads every route through the same
// context renderRouter('./app') uses, before any test starts, so no test's time includes it.
export function preloadAppRoutes() {
  const context = getMockContext('./app');
  for (const key of context.keys()) context(key);
}

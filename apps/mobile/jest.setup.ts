// The root layout imports expo-notifications, whose first load calls native mocks that must return a
// Promise. Loading it here, before any test's jest.resetAllMocks() empties those mocks, keeps that true.
import 'expo-notifications';
import NotificationsEmitterModule from 'expo-notifications/build/NotificationsEmitterModule';
import { PermissionStatus } from 'expo';
import NotificationPermissionsModule from 'expo-notifications/build/NotificationPermissionsModule';
import NotificationScheduler from 'expo-notifications/build/NotificationScheduler';

// jest-expo's stand-in for the native notifications emitter answers the synchronous
// getLastNotificationResponse with a Promise, which expo-notifications then fails to read. A launch
// with no notification tap answers null, so every test starts from that.
NotificationsEmitterModule.getLastNotificationResponse = () => null;

// Reanimated's own mock makes every animation finish at once, so no test waits on motion.
// The real worklets runtime needs the native module, so its own mock stands in for it.
// expo-router/testing-library installs the same Reanimated mock itself.
// https://docs.swmansion.com/react-native-reanimated/docs/guides/testing/
// Reanimated's mock has no useFrameCallback, so a frame callback that never fires is added to it; the frame maths
// is tested as plain functions in waveformPlayback.test.ts. It is added to the shared mock module because
// expo-router's testing library installs its own jest.mock of Reanimated from the same module.
Object.assign(jest.requireActual('react-native-reanimated/mock'), {
  useFrameCallback: () => ({ setActive: () => undefined, isActive: false, callbackId: -1 }),
});
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));

// The same stand-in answers getPermissionsAsync with nothing, so the app-start reminder sync would read
// `status` of undefined. Not yet asked is the state of a fresh install; suites that care mock the call.
NotificationPermissionsModule.getPermissionsAsync = async () => ({
  status: PermissionStatus.UNDETERMINED,
  granted: false,
  canAskAgain: true,
  expires: 'never',
});

// Likewise the scheduler stand-in answers the list of pending reminders with nothing, which the sync reads
// before it plans. A fresh install has none pending.
NotificationScheduler.getAllScheduledNotificationsAsync = async () => [];

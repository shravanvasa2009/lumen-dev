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

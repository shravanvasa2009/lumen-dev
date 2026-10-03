// The root layout imports expo-notifications, whose first load calls native mocks that must return a
// Promise. Loading it here, before any test's jest.resetAllMocks() empties those mocks, keeps that true.
import 'expo-notifications';
import NotificationsEmitterModule from 'expo-notifications/build/NotificationsEmitterModule';

// jest-expo's stand-in for the native notifications emitter answers the synchronous
// getLastNotificationResponse with a Promise, which expo-notifications then fails to read. A launch
// with no notification tap answers null, so every test starts from that.
NotificationsEmitterModule.getLastNotificationResponse = () => null;

import { NativeModules } from 'react-native';

// Lumen runs only as a development build (its camera module is native), never in Expo Go. jest-expo mocks
// every Expo native module, ExpoGo included, so isRunningInExpoGo() is true in tests and expo-notifications
// prints its Expo Go push warning in every suite that loads it. Removing that one mock from both tables
// jest-expo builds Expo's module proxy from gives tests the app's real environment without mocking `expo`,
// which suites such as care-map mock themselves. It must run before anything imports `expo`.
delete NativeModules.ExpoGo;
delete NativeModules.NativeUnimoduleProxy.exportedMethods.ExpoGo;
delete NativeModules.NativeUnimoduleProxy.modulesConstants.ExpoGo;

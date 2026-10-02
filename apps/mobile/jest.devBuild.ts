import { NativeModulesProxy } from 'expo-modules-core';

// Lumen runs only as a development build (its camera module is native), never in Expo Go. jest-expo mocks
// every Expo native module, ExpoGo included, so isRunningInExpoGo() is true in tests and expo-notifications
// prints its Expo Go push warning in every suite that loads it. Removing that one mock gives tests the app's
// real environment. It must run before anything imports `expo`, which reads it once at load.
delete NativeModulesProxy.ExpoGo;

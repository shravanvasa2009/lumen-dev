import { LumenCapture } from './index';

// Jest links no native modules, like Expo Go; importing the package must not throw there.
test('the native binding is null, not an import-time error, when the module is not linked', () => {
  expect(LumenCapture).toBeNull();
});
